import { useEffect, useRef } from 'react';

export const useInactivityTimer = (onTimeout: () => void, timeoutMs: number = 15 * 60 * 1000) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(onTimeout, timeoutMs);
  };

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'scroll'];

    const handleUserActivity = () => resetTimer();

    events.forEach((event) => window.addEventListener(event, handleUserActivity));
    resetTimer(); // Initialize on mount

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((event) => window.removeEventListener(event, handleUserActivity));
    };
  }, [timeoutMs, onTimeout]);
};
