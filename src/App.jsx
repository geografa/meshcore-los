import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { fetchNodes, prepareNode, searchNodes } from './lib/nodes.js';
import { getClearance, getProfileLines } from './lib/profile-chart.js';
import { createFresnelLayer } from './fresnel-layer.js';
import { computeProfile } from './profile-client.js';
import ProfileChart from './ProfileChart.jsx';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const HEIGHTS = [2, 5, 10, 20, 30];
const SPREADING_FACTORS = [5, 6, 7, 8, 9, 10, 11, 12];
const BANDWIDTHS = [31.25, 62.5, 125, 250, 500];
const ROUNDING = [[0, 'Off'], [0.25, '25 %'], [0.5, '50 %'], [1, 'Full']];
const DEFAULT_RADIO = { freq: 869.618, bw: 62.5, sf: 8 };
const STATUS = { clear: 'Fresnel zone clear', fresnel: 'Fresnel zone partly blocked', blocked: 'Line of sight blocked' };
const EMPTY = { type: 'FeatureCollection', features: [] };
const KEY = /^[0-9a-f]{64}$/i;
const url = new URLSearchParams(location.search);

const num = (value, fallback) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
const validRadio = ({ freq, bw, sf }) => freq > 0 && bw > 0 && sf >= 5 && sf <= 12;
const radioFromParams = p => { const r = { freq: Number(p?.freq), bw: Number(p?.bw), sf: Number(p?.sf) }; return validRadio(r) ? r : null; };
const toEnd = n => ({ key: n.public_key, name: n.adv_name, lat: n.lat, lon: n.lon, params: n.params });
const siteParam = e => e.key ?? `${e.lat.toFixed(5)},${e.lon.toFixed(5)}`;

function bearingOf(a, b) {
	const r = Math.PI / 180, dLon = (b.lon - a.lon) * r;
	const y = Math.sin(dLon) * Math.cos(b.lat * r);
	const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos(dLon);
	return (Math.atan2(y, x) / r + 360) % 360;
}

function NumField({ label, value, onChange, step = 1, min = 0 }) {
	const [text, setText] = useState(String(value));
	useEffect(() => setText(String(value)), [value]);
	return (
		<label>{label}
			<input type="number" step={step} min={min} value={text} onChange={e => {
				setText(e.target.value);
				const n = parseFloat(e.target.value);
				if(Number.isFinite(n) && n >= min) onChange(n);
			}} />
		</label>
	);
}

function Chips({ value, onChange }) {
	return <div className="chips">{HEIGHTS.map(h => <button key={h} className={h === value ? 'on' : ''} onClick={() => onChange(h)}>{h} m</button>)}</div>;
}

function End({ label, end, height, onHeight, hint }) {
	return (
		<div className="end">
			<div className="endhead"><b className="tag">{label}</b><span className={end ? 'endname' : 'endname hint'}>{end ? end.name : hint}</span></div>
			{end && <Chips value={height} onChange={onHeight} />}
		</div>
	);
}

export default function App() {
	const mapEl = useRef(null), mapRef = useRef(null), layerRef = useRef(null);
	const byKey = useRef(new Map()), pickRef = useRef(() => {});
	const [ready, setReady] = useState(false);
	const [nodes, setNodes] = useState([]);
	const [notice, setNotice] = useState('');
	const [a, setA] = useState(null), [b, setB] = useState(null);
	const [hA, setHA] = useState(num(url.get('ha'), 5)), [hB, setHB] = useState(num(url.get('hb'), 5));
	const [radio, setRadio] = useState(() => {
		const [freq, bw, sf] = (url.get('r') ?? '').split(',').map(Number);
		return validRadio({ freq, bw, sf }) ? { freq, bw, sf } : DEFAULT_RADIO;
	});
	const [tx, setTx] = useState(22), [gain, setGain] = useState(2);
	const [rounding, setRounding] = useState(0.25), [clutter, setClutter] = useState(true);
	const [result, setResult] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
	const [hover, setHover] = useState(null), [query, setQuery] = useState('');

	// the first end also sets the radio settings of the profile, like a node's own settings would
	pickRef.current = end => {
		if(!a) {
			setA(end);
			const r = radioFromParams(end.params);
			if(r) setRadio(r);
		} else setB(end);
	};

	// map: Mapterhorn terrain (the elevation data of the profile model), the 3D layer, the nodes
	useEffect(() => {
		if(!mapboxgl.accessToken) { setNotice('Set VITE_MAPBOX_TOKEN in .env and restart the dev server.'); return; }
		const map = new mapboxgl.Map({
			container: mapEl.current, style: 'mapbox://styles/grafa/cmwe6whhp007k01sm67b1hth6',
			center: [-122.6735, 45.5125], zoom: 11, pitch: 60, projection: 'mercator', antialias: true,
		});
		mapRef.current = map;
		map.addControl(new mapboxgl.NavigationControl());
		map.boxZoom.disable(); // shift+drag box zoom swallows the click this gesture needs
		map.on('load', () => {
			map.addSource('dem', { type: 'raster-dem', tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'], tileSize: 512, maxzoom: 12, encoding: 'terrarium' });
			map.setTerrain({ source: 'dem', exaggeration: 1 });
			layerRef.current = createFresnelLayer();
			map.addLayer(layerRef.current);

			map.addSource('nodes', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 45, clusterMaxZoom: 11 });
			map.addSource('ends', { type: 'geojson', data: EMPTY });
			map.addLayer({ id: 'clusters', type: 'circle', source: 'nodes', filter: ['has', 'point_count'], paint: {
				'circle-color': '#2a6f8f', 'circle-opacity': 0.9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
				'circle-radius': ['step', ['get', 'point_count'], 14, 20, 18, 100, 24] } });
			map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'nodes', filter: ['has', 'point_count'],
				layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 }, paint: { 'text-color': '#fff' } });
			map.addLayer({ id: 'node-points', type: 'circle', source: 'nodes', filter: ['!', ['has', 'point_count']], paint: {
				'circle-radius': 6, 'circle-color': ['match', ['get', 'type'], 2, '#2a6f8f', 3, '#b779f0', '#aaa'],
				'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
			map.addLayer({ id: 'ends', type: 'circle', source: 'ends', paint: {
				'circle-radius': 11, 'circle-color': '#1b6ef3', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
			map.addLayer({ id: 'ends-label', type: 'symbol', source: 'ends',
				layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });

			map.on('click', 'node-points', e => {
				const node = byKey.current.get(e.features[0].properties.key);
				if(node) pickRef.current(toEnd(node));
			});
			map.on('click', 'clusters', e => {
				const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
				map.getSource('nodes').getClusterExpansionZoom(feature.properties.cluster_id, (err, zoom) => {
					if(!err) map.easeTo({ center: feature.geometry.coordinates, zoom: zoom + 0.5 });
				});
			});
			// shift+click picks any point on the ground
			map.on('click', e => {
				if(!e.originalEvent.shiftKey) return;
				const hit = map.queryRenderedFeatures(e.point, { layers: ['node-points', 'clusters'] });
				if(!hit.length) pickRef.current({ name: 'Picked point', lat: e.lngLat.lat, lon: e.lngLat.lng });
			});
			for(const layer of ['node-points', 'clusters']) {
				map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
				map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
			}
			setReady(true);
		});
		return () => map.remove();
	}, []);

	useEffect(() => {
		fetchNodes()
			.then(list => { list.forEach(prepareNode); setNodes(list); })
			.catch(e => setNotice(`Could not load nodes: ${e.message}. See the README about the nodes API and CORS.`));
	}, []);

	// repeaters and room servers on the map; ends from the URL are resolved once the nodes are there
	useEffect(() => {
		if(!ready || !nodes.length) return;
		byKey.current = new Map(nodes.map(n => [n.public_key, n]));
		mapRef.current.getSource('nodes').setData({ type: 'FeatureCollection', features: nodes
			.filter(n => (n.type === 2 || n.type === 3) && Number.isFinite(n.lat) && Number.isFinite(n.lon))
			.map(n => ({ type: 'Feature', properties: { key: n.public_key, name: n.adv_name, type: n.type }, geometry: { type: 'Point', coordinates: [n.lon, n.lat] } })) });
		const decode = value => {
			if(!value) return null;
			if(KEY.test(value)) { const node = byKey.current.get(value.toLowerCase()); return node ? toEnd(node) : null; }
			const [lat, lon] = value.split(',').map(Number);
			return Number.isFinite(lat) && Number.isFinite(lon) ? { name: 'Picked point', lat, lon } : null;
		};
		const fromUrl = [decode(url.get('a')), decode(url.get('b'))];
		if(fromUrl[0]) setA(fromUrl[0]);
		if(fromUrl[1]) setB(fromUrl[1]);
	}, [ready, nodes]);

	useEffect(() => {
		if(!ready) return;
		const map = mapRef.current;
		map.getSource('ends').setData({ type: 'FeatureCollection', features: [['A', a], ['B', b]].filter(([, e]) => e)
			.map(([label, e]) => ({ type: 'Feature', properties: { label }, geometry: { type: 'Point', coordinates: [e.lon, e.lat] } })) });
		if(a && b) {
			map.fitBounds([[Math.min(a.lon, b.lon), Math.min(a.lat, b.lat)], [Math.max(a.lon, b.lon), Math.max(a.lat, b.lat)]], {
				padding: { top: 60, bottom: 340, left: 360, right: 60 }, pitch: 65, bearing: (bearingOf(a, b) + 90) % 360, duration: 1200, maxZoom: 15 });
		} else if(a) map.easeTo({ center: [a.lon, a.lat], duration: 600 });
	}, [ready, a, b]);

	// profile and link budget (coverage-model.js in a worker); the result keeps the inputs it belongs to
	useEffect(() => {
		if(!a || !b) { setResult(null); setError(''); return; }
		let stale = false;
		setLoading(true);
		const timer = setTimeout(() => {
			computeProfile({
				a: { lat: a.lat, lon: a.lon, height: hA, gain }, b: { lat: b.lat, lon: b.lon, height: hB, gain },
				settings: { txPower: tx, antennaGain: gain, clutter, ridgeRounding: rounding }, radio, rounding,
			}).then(r => { if(!stale) { setResult({ ...r, a, b, hA, hB }); setError(''); setLoading(false); } })
				.catch(e => { if(!stale) { setResult(null); setError(e.message); setLoading(false); } });
		}, 150);
		return () => { stale = true; clearTimeout(timer); };
	}, [a, b, hA, hB, tx, gain, rounding, clutter, radio]);

	const lines = useMemo(() => result && getProfileLines(result, result.hA, result.hB), [result]);
	const clearance = useMemo(() => lines && getClearance(lines), [lines]);

	useEffect(() => {
		const layer = layerRef.current;
		if(!ready || !layer) return;
		if(!result) { layer.setData(null); return; }
		const last = result.elevations.length - 1;
		layer.setData({
			a: result.a, b: result.b, gA: result.elevations[0], gB: result.elevations[last], hA: result.hA, hB: result.hB,
			wavelength: result.wavelength, status: clearance.status,
			hover: hover === null ? null : { f: hover / last, ground: result.elevations[hover] },
		});
	}, [ready, result, clearance, hover]);

	useEffect(() => {
		const p = new URLSearchParams();
		if(a) p.set('a', siteParam(a));
		if(b) p.set('b', siteParam(b));
		p.set('ha', hA); p.set('hb', hB); p.set('r', `${radio.freq},${radio.bw},${radio.sf}`);
		history.replaceState(null, '', `?${p}`);
	}, [a, b, hA, hB, radio]);

	const repeaters = useMemo(() => nodes.filter(n => (n.type === 2 || n.type === 3) && n.adv_name), [nodes]);
	const matches = useMemo(() => query.trim().length >= 2 ? searchNodes(repeaters, query.trim(), { limit: 8 }) : [], [repeaters, query]);
	const choose = node => {
		pickRef.current(toEnd(node));
		setQuery('');
		mapRef.current.flyTo({ center: [node.lon, node.lat], zoom: 13 });
	};
	const swap = () => { setA(b); setB(a); setHA(hB); setHB(hA); };
	const clear = () => { setA(null); setB(null); };
	const losses = result?.losses;
	const free = clearance && Number.isFinite(clearance.worst) ? Math.max(0, Math.min(100, Math.round(clearance.worst * 100))) : null;

	return (
		<div className="app">
			<div ref={mapEl} className="map" />
			<aside className="panel side">
				<h1>Link profile in 3D</h1>
				<div className="search">
					<input placeholder="Search repeaters by name or key" value={query} onChange={e => setQuery(e.target.value)} />
					{matches.length > 0 && <ul>{matches.map(n => <li key={n.public_key}><button onClick={() => choose(n)}>{n.adv_name}</button></li>)}</ul>}
				</div>
				<End label="A" end={a} height={hA} onHeight={setHA} hint="Click a node on the map" />
				<End label="B" end={b} height={hB} onHeight={setHB} hint={a ? 'Click the second node' : 'Then the second node'} />
				<div className="row">
					<button onClick={swap} disabled={!a || !b}>Swap A and B</button>
					<button onClick={clear} disabled={!a && !b}>Clear</button>
				</div>
				<p className="fine">Shift+click picks any point on the ground.</p>
				<fieldset>
					<legend>Radio</legend>
					<NumField label="Frequency (MHz)" value={radio.freq} step={0.001} min={150} onChange={freq => setRadio({ ...radio, freq })} />
					<label>Bandwidth (kHz)
						<select value={radio.bw} onChange={e => setRadio({ ...radio, bw: Number(e.target.value) })}>
							{[...new Set([...BANDWIDTHS, radio.bw])].sort((x, y) => x - y).map(v => <option key={v}>{v}</option>)}
						</select>
					</label>
					<label>Spreading factor
						<select value={radio.sf} onChange={e => setRadio({ ...radio, sf: Number(e.target.value) })}>
							{SPREADING_FACTORS.map(v => <option key={v}>{v}</option>)}
						</select>
					</label>
					<NumField label="TX power (dBm)" value={tx} min={1} onChange={setTx} />
					<NumField label="Antenna gain (dBi)" value={gain} step={0.5} onChange={setGain} />
				</fieldset>
				<fieldset>
					<legend>Model</legend>
					<label>Rounded ridges
						<select value={rounding} onChange={e => setRounding(Number(e.target.value))}>
							{ROUNDING.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
						</select>
					</label>
					<label className="check"><input type="checkbox" checked={clutter} onChange={e => setClutter(e.target.checked)} />Buildings and trees at the antennas</label>
				</fieldset>
				{notice && <p className="error">{notice}</p>}
			</aside>

			{(result || loading || error) && (
				<section className="panel bottom">
					{error && <p className="error">{error}</p>}
					{result && (
						<>
							<div className="summary">
								<span className={`badge ${clearance.status}`}>{STATUS[clearance.status]}</span>
								<dl className="stats">
									<div><dt>Link margin</dt><dd>{result.margin >= 0 ? '+' : ''}{result.margin.toFixed(1)} dB</dd></div>
									<div><dt>Distance</dt><dd>{(result.distance / 1000).toFixed(2)} km</dd></div>
									<div><dt>Path loss</dt><dd>{losses.total.toFixed(1)} dB</dd></div>
									<div><dt>Bearing A→B / B→A</dt><dd>{result.bearing.toFixed(1)}° / {result.backBearing.toFixed(1)}°</dd></div>
									{free !== null && <div><dt>First zone free</dt><dd>{free} %</dd></div>}
								</dl>
							</div>
							<ProfileChart samples={lines} hover={hover} onHover={setHover} />
							<p className="fine">
								Free space {losses.freeSpace.toFixed(1)} + diffraction {losses.diffraction.toFixed(1)} + antenna clutter {(losses.clutterA + losses.clutterB).toFixed(1)} dB.
								{' '}Ground and canopy from Mapterhorn terrain and OpenStreetMap land cover; 10 dB fade margin included.
								{result.incomplete && ' Some map tiles failed to load, so the profile may be incomplete.'}
							</p>
						</>
					)}
					{loading && !result && <p className="fine">Sampling terrain…</p>}
				</section>
			)}
		</div>
	);
}
