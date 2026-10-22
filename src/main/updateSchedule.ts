export function scheduleUpdateChecks(check: () => void): () => void {
  const initial = setTimeout(check, 60 * 1000)
  const recurring = setInterval(check, 24 * 60 * 60 * 1000)
  return () => {
    clearTimeout(initial)
    clearInterval(recurring)
  }
}
