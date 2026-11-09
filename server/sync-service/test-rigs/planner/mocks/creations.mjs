let n = 0;
export async function startJob() { return `job-${++n}`; }
export function onCreationDone() {}
export function creationOf() { return null; }
