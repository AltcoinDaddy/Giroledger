import { motion, useReducedMotion } from "motion/react";

/**
 * Enter-on-scroll, once, on a spring.
 *
 * MOTION_INTENSITY 5 on the landing page. Entry transitions and hover, nothing
 * else: no pinning, no parallax, no scroll hijack.
 *
 * A spring rather than a bezier because the two feel different at the end. An
 * ease curve arrives exactly on time and stops dead, which reads as mechanical
 * at this size. A soft spring decelerates into place and settles, which is what
 * makes the difference between "animated" and "calm". Damping is high enough
 * that nothing visibly overshoots; the point is the shape of the deceleration.
 *
 * `useReducedMotion` collapses it to a plain render, and `once: true` means
 * nothing re-animates on scroll-back, which is the thing that makes reveal
 * effects feel cheap on a second pass.
 */
export function Reveal(props: {
  children: React.ReactNode;
  delay?: number;
  /** Distance travelled. Smaller for text, larger for panels. */
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const y = props.y ?? 12;

  return (
    <motion.div
      className={props.className}
      initial={reduce === true ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{
        type: "spring",
        stiffness: 120,
        damping: 22,
        mass: 0.9,
        delay: props.delay ?? 0,
        opacity: { duration: 0.5, delay: props.delay ?? 0 },
      }}
    >
      {props.children}
    </motion.div>
  );
}
