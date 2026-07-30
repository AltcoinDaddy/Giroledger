// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RuleRegistry
 * @notice Stores GiroLedger standing orders. Owns state, never funds.
 *
 * A rule is created by a Flare Smart Accounts `PersonalAccount` calling
 * `createRule` as part of the user operation dispatched from a single XRPL
 * payment. `msg.sender` is recorded as the rule's owner and beneficiary, so
 * authorisation traces back to the XRPL payment signature.
 *
 * This contract deliberately cannot move tokens. Everything that touches funds
 * lives in `RuleExecutor`, which is the only address permitted to call
 * `markExecuted`. Keeping the two apart means a bug in accounting cannot
 * become a bug in custody.
 *
 * Scope note: only `Trigger.TIME` is enabled. Price triggers are in the enum
 * for forward compatibility but `createRule` rejects them, per spec.md §11.
 * Do not enable them until acceptance criterion A5 has passed.
 */
contract RuleRegistry is Ownable {
    // -------------------------------------------------------------- types --

    enum Trigger {
        TIME,
        PRICE_BELOW,
        PRICE_ABOVE
    }

    struct Rule {
        address account; // PersonalAccount: owner and beneficiary
        address vault; // ERC-4626 target
        uint128 amountPerRun;
        uint128 totalSpendCap;
        uint128 totalSpent;
        uint64 nextRunAt;
        uint32 intervalSecs;
        uint16 maxRuns; // 0 = until the cap is exhausted
        uint16 runsDone;
        int128 thresholdPrice; // unused while only TIME is enabled
        Trigger trigger;
        bool active;
    }

    struct CreateRuleParams {
        address vault;
        uint128 amountPerRun;
        uint128 totalSpendCap;
        uint32 intervalSecs;
        uint16 maxRuns;
        uint8 trigger;
        uint64 startAt; // 0 = now
        int128 thresholdPrice;
    }

    // ---------------------------------------------------------- constants --

    uint32 public constant MIN_INTERVAL_SECS = 60;
    uint32 public constant MAX_INTERVAL_SECS = 365 days;
    uint256 public constant MAX_PAGE = 200;

    // ------------------------------------------------------------ storage --

    mapping(bytes32 ruleId => Rule) private _rules;
    mapping(address account => uint256) public nonces;
    mapping(address account => bytes32[]) private _rulesOf;
    mapping(address vault => bool) public vaultAllowed;

    bytes32[] private _allRuleIds;
    address public executor;

    // ------------------------------------------------------------- events --

    event RuleCreated(
        bytes32 indexed ruleId,
        address indexed account,
        address vault,
        uint128 amountPerRun,
        uint128 totalSpendCap,
        Trigger trigger
    );
    event RuleExecuted(bytes32 indexed ruleId, address indexed account, uint128 amount, uint64 at);
    event RuleCancelled(bytes32 indexed ruleId, address indexed account);
    event RuleExhausted(bytes32 indexed ruleId, address indexed account);
    event ExecutorSet(address indexed executor);
    event VaultAllowed(address indexed vault, bool allowed);

    // ------------------------------------------------------------- errors --

    error NotAccount();
    error NotExecutor();
    error RuleNotActive();
    error RuleNotDue();
    error CapExceeded();
    error VaultNotAllowed();
    error InvalidParams();
    error TriggerNotEnabled();
    error PageTooLarge();
    error UnknownRule();

    // -------------------------------------------------------- constructor --

    constructor(address initialOwner) Ownable(initialOwner) {}

    // -------------------------------------------------------------- admin --

    function setExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) revert InvalidParams();
        executor = newExecutor;
        emit ExecutorSet(newExecutor);
    }

    /// @notice Allowlist a vault. Without this an arbitrary address could be passed as `vault`.
    function setVaultAllowed(address vault, bool allowed) external onlyOwner {
        if (vault == address(0)) revert InvalidParams();
        vaultAllowed[vault] = allowed;
        emit VaultAllowed(vault, allowed);
    }

    // --------------------------------------------------------- rule admin --

    /**
     * @notice Create a standing order. The caller becomes the rule's owner.
     * @dev Called by a PersonalAccount inside the user operation dispatched
     *      from the user's XRPL payment.
     */
    function createRule(CreateRuleParams calldata p) external returns (bytes32 ruleId) {
        if (!vaultAllowed[p.vault]) revert VaultNotAllowed();
        if (p.amountPerRun == 0) revert InvalidParams();
        if (p.totalSpendCap < p.amountPerRun) revert CapExceeded();
        if (p.intervalSecs < MIN_INTERVAL_SECS || p.intervalSecs > MAX_INTERVAL_SECS) {
            revert InvalidParams();
        }
        // Only TIME is live. See spec.md §11.
        if (p.trigger != uint8(Trigger.TIME)) revert TriggerNotEnabled();

        uint64 startAt = p.startAt == 0 ? uint64(block.timestamp) : p.startAt;

        unchecked {
            ruleId = keccak256(abi.encode(msg.sender, nonces[msg.sender]++));
        }

        _rules[ruleId] = Rule({
            account: msg.sender,
            vault: p.vault,
            amountPerRun: p.amountPerRun,
            totalSpendCap: p.totalSpendCap,
            totalSpent: 0,
            nextRunAt: startAt,
            intervalSecs: p.intervalSecs,
            maxRuns: p.maxRuns,
            runsDone: 0,
            thresholdPrice: p.thresholdPrice,
            trigger: Trigger(p.trigger),
            active: true
        });

        _rulesOf[msg.sender].push(ruleId);
        _allRuleIds.push(ruleId);

        emit RuleCreated(
            ruleId, msg.sender, p.vault, p.amountPerRun, p.totalSpendCap, Trigger(p.trigger)
        );
    }

    /// @notice Cancel a rule. Idempotent: cancelling an inactive rule is a no-op.
    function cancelRule(bytes32 ruleId) external {
        Rule storage r = _rules[ruleId];
        if (r.account == address(0)) revert UnknownRule();
        if (r.account != msg.sender) revert NotAccount();
        if (!r.active) return;

        r.active = false;
        emit RuleCancelled(ruleId, r.account);
    }

    /**
     * @notice Record a completed execution. Executor only.
     * @dev This is the effect half of checks-effects-interactions. The executor
     *      calls this BEFORE moving any tokens, so a reentrant call sees the
     *      updated counters and fails the due check.
     */
    function markExecuted(bytes32 ruleId, uint128 amount) external {
        if (msg.sender != executor) revert NotExecutor();

        Rule storage r = _rules[ruleId];
        if (r.account == address(0)) revert UnknownRule();
        if (!r.active) revert RuleNotActive();
        if (!_isDue(r)) revert RuleNotDue();
        if (amount != r.amountPerRun) revert InvalidParams();
        // Belt and braces: _isDue already enforces this.
        if (uint256(r.totalSpent) + amount > r.totalSpendCap) revert CapExceeded();

        r.totalSpent += amount;
        unchecked {
            ++r.runsDone;
        }
        r.nextRunAt = uint64(block.timestamp) + r.intervalSecs;

        emit RuleExecuted(ruleId, r.account, amount, uint64(block.timestamp));

        if (_isExhausted(r)) {
            r.active = false;
            emit RuleExhausted(ruleId, r.account);
        }
    }

    // --------------------------------------------------------------- views --

    function getRule(bytes32 ruleId) external view returns (Rule memory) {
        return _rules[ruleId];
    }

    function isDue(bytes32 ruleId) external view returns (bool) {
        return _isDue(_rules[ruleId]);
    }

    function rulesOf(address account) external view returns (bytes32[] memory) {
        return _rulesOf[account];
    }

    function totalRules() external view returns (uint256) {
        return _allRuleIds.length;
    }

    /**
     * @notice Paginated scan for due rules. Never unbounded.
     * @param offset index into the full rule list
     * @param limit  max rules to inspect, capped at MAX_PAGE
     * @return ids        due rule ids found in this window
     * @return nextOffset where the next call should start, equal to total when finished
     */
    function dueRules(uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory ids, uint256 nextOffset)
    {
        if (limit == 0 || limit > MAX_PAGE) revert PageTooLarge();

        uint256 total = _allRuleIds.length;
        if (offset >= total) return (new bytes32[](0), total);

        uint256 end = offset + limit;
        if (end > total) end = total;

        bytes32[] memory buffer = new bytes32[](end - offset);
        uint256 found;

        for (uint256 i = offset; i < end; ++i) {
            bytes32 id = _allRuleIds[i];
            if (_isDue(_rules[id])) {
                buffer[found] = id;
                unchecked {
                    ++found;
                }
            }
        }

        ids = new bytes32[](found);
        for (uint256 i; i < found; ++i) {
            ids[i] = buffer[i];
        }
        nextOffset = end;
    }

    // ------------------------------------------------------------ internal --

    function _isDue(Rule storage r) internal view returns (bool) {
        if (!r.active) return false;
        if (r.trigger != Trigger.TIME) return false;
        if (block.timestamp < r.nextRunAt) return false;
        if (_isExhausted(r)) return false;
        return true;
    }

    function _isExhausted(Rule storage r) internal view returns (bool) {
        if (r.maxRuns != 0 && r.runsDone >= r.maxRuns) return true;
        if (uint256(r.totalSpent) + r.amountPerRun > r.totalSpendCap) return true;
        return false;
    }
}
