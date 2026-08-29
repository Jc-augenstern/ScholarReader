import { useEffect, useState, type RefObject } from "react";

export type ElementSize = { width: number; height: number };

export function useElementSize<T extends HTMLElement>(
  ref: RefObject<T | null>,
  enabled = true,
): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, ref]);

  return size;
}
