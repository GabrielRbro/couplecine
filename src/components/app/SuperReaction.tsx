import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";

export function SuperReaction({ emoji, origin, onComplete }: { emoji: string; origin: {x:number;y:number}; onComplete: () => void }) {
  const reduce = useReducedMotion();
  if (typeof document === "undefined") return null;
  return createPortal(<div aria-hidden className="pointer-events-none fixed inset-0 z-[240] overflow-hidden" data-super-reaction>
    {Array.from({length:reduce ? 3 : 9},(_,i) => <motion.span key={i} className="emoji absolute text-3xl" style={{left:origin.x-16,top:origin.y-16}}
      initial={{opacity:0,scale:.65,x:0,y:0,rotate:0}} animate={{opacity:[0,1,1,0],scale:[.65,1.15,.9],x:reduce ? (i-1)*24 : (i-4)*25,y:reduce ? -35 : -160-(i%3)*50,rotate:reduce ? 0 : (i%2 ? 1 : -1)*(10+i*3)}}
      transition={{duration:reduce ? .5 : .7,delay:i*.015}} onAnimationComplete={i === (reduce ? 2 : 8) ? onComplete : undefined}>{emoji}</motion.span>)}
  </div>,document.body);
}