// Module-level store — shares forwarded QC batches between ProductionScreen and QCScreen
let batches = [];
const listeners = new Set();

export const qcStore = {
  getBatches: () => [...batches],
  add(batch) {
    if (batches.some(b => b.id === batch.id)) return;
    batches = [...batches, batch];
    listeners.forEach(fn => fn([...batches]));
  },
  remove(id) {
    batches = batches.filter(b => b.id !== id);
    listeners.forEach(fn => fn([...batches]));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
