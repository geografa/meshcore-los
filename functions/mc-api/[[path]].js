// Same-origin proxy for the MeshCore nodes API. map.meshcore.io only allows
// CORS from map.meshcore.dev, so the browser must call /mc-api on this origin.
export async function onRequest({ request }) {
	const incoming = new URL(request.url);
	const path = incoming.pathname.replace(/^\/mc-api(?=\/|$)/, '/api');
	const headers = new Headers(request.headers);
	headers.delete('host');
	headers.set('origin', 'https://map.meshcore.io');

	const upstream = await fetch(`https://map.meshcore.io${path}${incoming.search}`, {
		method: request.method,
		headers,
		redirect: 'follow',
	});

	const out = new Headers(upstream.headers);
	out.delete('access-control-allow-origin');
	out.delete('access-control-allow-credentials');
	return new Response(upstream.body, { status: upstream.status, headers: out });
}
