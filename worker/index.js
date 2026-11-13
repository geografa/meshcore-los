const ORIGIN = 'https://map.meshcore.io';

export default {
	async fetch(request) {
		const incoming = new URL(request.url);
		if(!incoming.pathname.startsWith('/mc-api')) return new Response(null, { status: 404 });

		const path = incoming.pathname.replace(/^\/mc-api(?=\/|$)/, '/api');
		const upstream = await fetch(`${ORIGIN}${path}${incoming.search}`, {
			method: request.method,
			headers: {
				accept: request.headers.get('accept') || 'application/msgpack',
				'user-agent': request.headers.get('user-agent') || 'meshcore-los',
			},
			redirect: 'follow',
		});

		const body = await upstream.arrayBuffer();
		const headers = new Headers();
		const type = upstream.headers.get('content-type');
		if(type) headers.set('content-type', type);
		headers.set('cache-control', 'public, max-age=60');
		return new Response(body, { status: upstream.status, headers });
	},
};
