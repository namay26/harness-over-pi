/** Calls `onStall` if no session event arrives for `idleMs` while no tool is running. */
export function watchStall(idleMs: number, onStall: () => void) {
  let tools = 0;
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(timer);
    if (tools === 0) timer = setTimeout(onStall, idleMs);
  };
  arm();
  return {
    see(eventType: string): void {
      if (eventType === "tool_execution_start") tools++;
      if (eventType === "tool_execution_end") tools--;
      arm();
    },
    stop: () => clearTimeout(timer),
  };
}
