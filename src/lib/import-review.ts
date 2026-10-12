export function reviewStartIndex(items: readonly { status: string }[]) {
  const firstOpen = items.findIndex((item) => item.status === "pending" || item.status === "error");
  return firstOpen === -1 ? items.length : firstOpen;
}
