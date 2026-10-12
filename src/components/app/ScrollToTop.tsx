import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    const update = () => setVisible(window.scrollY > 560);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="scroll-top-control fixed z-30"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
        >
          <Button
            variant="ghost"
            size="icon"
            title="Voltar ao topo"
            aria-label="Voltar ao topo"
            className="nav-glass h-11 w-11 rounded-full border border-border"
            onClick={() => window.scrollTo({ top: 0, behavior: reduce ? "instant" : "smooth" })}
          >
            <ChevronUp />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
