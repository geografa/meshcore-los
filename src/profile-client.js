// Runs coverage-model.js's computeProfile in a worker (the original site's coverage-worker.js)
let worker = null, nextId = 0;
const pending = new Map();

// job: { a: {lat, lon, height, gain}, b, settings: {txPower, clutter}, radio: {freq, bw, sf}, rounding }
export function computeProfile(job) {
	if(!worker) {
		worker = new Worker(new URL('./lib/coverage-worker.js', import.meta.url), { type: 'module' });
		worker.onmessage = ({ data: { id, result, error } }) => {
			const request = pending.get(id);
			pending.delete(id);
			if(error) request?.reject(new Error(error));
			else request?.resolve(result);
		};
	}
	return new Promise((resolve, reject) => {
		const id = ++nextId;
		pending.set(id, { resolve, reject });
		worker.postMessage({ id, kind: 'profile', job });
	});
}
