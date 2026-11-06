import { useEffect, useReducer, useRef, useState } from 'react';

// One request at a time; no stale response can replace data for a different route/filter.
export function useResource(load, key, { pollMs = 0, shouldPoll = () => true } = {}) {
  const loader = useRef(load);
  const policy = useRef(shouldPoll);
  loader.current = load;
  policy.current = shouldPoll;
  const [version, refresh] = useReducer(value => value + 1, 0);
  const [state, setState] = useState({ data: null, error: null, loading: true, refreshing: false });
  useEffect(() => {
    let disposed = false;
    let timer;
    let latest;
    let stop = false;
    const controller = new AbortController();
    setState(previous => ({ data: previous.key === key ? previous.data : null, key, error: null, loading: previous.key !== key || !previous.data, refreshing: true }));
    async function run() {
      try {
        const data = await loader.current(controller.signal);
        if (disposed) return;
        latest = data;
        setState({ key, data, error: null, loading: false, refreshing: false });
      } catch (error) {
        if (disposed) return;
        stop = error.status >= 400 && error.status < 500;
        setState(previous => ({ ...previous, error, loading: false, refreshing: false }));
      }
      if (!disposed && !stop && pollMs && (!latest || policy.current(latest))) {
        timer = setTimeout(() => {
          if (document.visibilityState === 'hidden') { timer = setTimeout(run, pollMs); }
          else void run();
        }, pollMs);
      }
    }
    void run();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [key, pollMs, version]);
  return state.key && state.key !== key
    ? { data: null, error: null, loading: true, refreshing: true, refresh }
    : { ...state, refresh };
}
