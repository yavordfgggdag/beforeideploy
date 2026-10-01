/** UTC calendar arithmetic: Jan 31 → Feb 28 → Mar 31, anchored to the original day. */
export function addMonths(anchor: Date, months: number): Date {
  const result = new Date(anchor);
  result.setUTCDate(1);
  result.setUTCMonth(anchor.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth()+1,0)).getUTCDate();
  result.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  return result;
}
export function monthlySlice(start: string, end: string, now: Date) {
  const anchor = new Date(start), stop = new Date(end);
  let month = Math.max(0, (now.getUTCFullYear()-anchor.getUTCFullYear())*12 + now.getUTCMonth()-anchor.getUTCMonth());
  if (addMonths(anchor,month).getTime()>now.getTime()) month = Math.max(0,month-1);
  return { month, start:addMonths(anchor,month).toISOString(), end:new Date(Math.min(addMonths(anchor,month+1).getTime(),stop.getTime())).toISOString() };
}
