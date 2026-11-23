// CI can stretch harness deadlines on slower shared runners (#1). It never relaxes product latency budgets.
export const testTimeScale = Math.max(1, Number(process.env.MOGURI_TEST_TIME_SCALE) || 1);
export const ciTime = (milliseconds: number) => milliseconds * testTimeScale;
