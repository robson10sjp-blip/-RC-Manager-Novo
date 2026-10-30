import { useLayoutEffect, useRef, useState } from "react";

export default function usePageSection(initial = "list") {
  const [active, setActive] = useState(initial);
  const navRef = useRef(null);
  const positions = useRef(new Map());
  const target = useRef(null);

  function select(section, { reset = false } = {}) {
    positions.current.set(active, window.scrollY);
    const top = navRef.current?.getBoundingClientRect().top + window.scrollY || 0;
    target.current = reset ? top : positions.current.get(section) ?? top;
    if (section === active) {
      window.scrollTo({ top: target.current, behavior: "instant" });
      target.current = null;
    } else {
      setActive(section);
    }
  }

  useLayoutEffect(() => {
    if (target.current !== null) {
      window.scrollTo({ top: target.current, behavior: "instant" });
      target.current = null;
    }
  }, [active]);

  return { active, select, navRef };
}
