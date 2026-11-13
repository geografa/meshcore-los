import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';

// Mapbox custom layer (Three.js): the first Fresnel zone as an ellipsoid between the two antenna tips,
// with the masts, the line of sight and an optional hover marker. Geometry is built in metres (east,
// north, up) around antenna A and scaled to mercator units at render time. Needs projection: 'mercator'.
const EARTH_RADIUS = 6371008.8;
const COLORS = { clear: 0x2fb36d, fresnel: 0xf0b429, blocked: 0xe5484d };
const UP = new THREE.Vector3(0, 1, 0);

export function createFresnelLayer() {
	let map = null, scene = null, camera = null, renderer = null, group = null, origin = null, data = null;

	function clear() {
		if(!group) return;
		scene.remove(group);
		group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
		group = null;
	}

	// d: { a, b ({lat, lon}), gA, gB (ground m), hA, hB (antenna heights m), wavelength, status, hover: {f, ground} | null }
	function build(d) {
		if(!scene) return;
		clear();
		if(d) {
			const { a, b, gA, gB, hA, hB, wavelength, status, hover } = d;
			origin = mapboxgl.MercatorCoordinate.fromLngLat([a.lon, a.lat], 0);
			const cos = Math.cos(a.lat * Math.PI / 180);
			const enu = (lat, lon, z) => new THREE.Vector3(
				(lon - a.lon) * Math.PI / 180 * EARTH_RADIUS * cos, (lat - a.lat) * Math.PI / 180 * EARTH_RADIUS, z);
			const pa = enu(a.lat, a.lon, gA + hA), pb = enu(b.lat, b.lon, gB + hB);
			const axis = pb.clone().sub(pa), length = axis.length();
			const width = Math.max(1, length / 700);
			group = new THREE.Group();

			// first zone: r(t) = sqrt(wavelength * t * (1 - t) * D) is an ellipsoid with semi-axes D / 2 and sqrt(wavelength * D) / 2
			const radius = Math.sqrt(wavelength * length) / 2, color = COLORS[status];
			const geometry = new THREE.SphereGeometry(1, 48, 24);
			for(const material of [
				new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
				new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }),
			]) {
				const mesh = new THREE.Mesh(geometry, material);
				mesh.scale.set(radius, length / 2, radius);
				mesh.quaternion.setFromUnitVectors(UP, axis.clone().normalize());
				mesh.position.copy(pa).add(pb).multiplyScalar(0.5);
				group.add(mesh);
			}

			const rod = (p, q, r, c) => {
				const v = q.clone().sub(p), rodLength = v.length();
				if(rodLength < 0.01) return new THREE.Object3D();
				const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, rodLength, 8), new THREE.MeshBasicMaterial({ color: c }));
				mesh.position.copy(p).add(q).multiplyScalar(0.5);
				mesh.quaternion.setFromUnitVectors(UP, v.normalize());
				return mesh;
			};
			group.add(rod(pa, pb, width * 0.6, 0x4aa3ff));
			group.add(rod(enu(a.lat, a.lon, gA), pa, width, 0xffffff));
			group.add(rod(enu(b.lat, b.lon, gB), pb, width, 0xffffff));

			if(hover) {
				const ground = enu(a.lat + (b.lat - a.lat) * hover.f, a.lon + (b.lon - a.lon) * hover.f, hover.ground);
				group.add(rod(ground, pa.clone().lerp(pb, hover.f), width * 0.6, 0xffffff));
				const dot = new THREE.Mesh(new THREE.SphereGeometry(width * 3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
				dot.position.copy(ground);
				group.add(dot);
			}
			scene.add(group);
		}
		map.triggerRepaint();
	}

	return {
		id: 'fresnel-3d',
		type: 'custom',
		renderingMode: '3d',
		onAdd(m, gl) {
			map = m;
			scene = new THREE.Scene();
			camera = new THREE.Camera();
			renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
			renderer.autoClear = false;
			build(data);
		},
		render(gl, matrix) {
			if(!group) return;
			const s = origin.meterInMercatorCoordinateUnits();
			const local = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(s, -s, s));
			camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(local);
			renderer.resetState();
			renderer.render(scene, camera);
		},
		setData(next) {
			data = next;
			build(next);
		},
	};
}
