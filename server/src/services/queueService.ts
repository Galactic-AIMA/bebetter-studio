type Task<T> = () => Promise<T>

interface QueueEntry {
  run: Task<any>
  resolve: (v: any) => void
  reject: (e: any) => void
}

let running = false
const queue: QueueEntry[] = []

function next() {
  if (running || queue.length === 0) return
  running = true
  const { run, resolve, reject } = queue.shift()!
  run()
    .then(resolve)
    .catch(reject)
    .finally(() => {
      running = false
      next()
    })
}

export function enqueue<T>(task: Task<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push({ run: task, resolve, reject })
    next()
  })
}

export function queueStatus() {
  return { running, queued: queue.length }
}
