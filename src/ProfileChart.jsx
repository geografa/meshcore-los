import { useEffect, useRef } from 'react';
import { drawProfileChart } from './lib/profile-chart.js';

// The original site's canvas profile chart; hovering reports the sample index (shown in 3D as well)
export default function ProfileChart({ samples, hover, onHover }) {
	const canvasRef = useRef(null);
	const indexAt = useRef(() => null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const draw = () => { indexAt.current = drawProfileChart(canvas, samples, { dark: true, hover }); };
		draw();
		const observer = new ResizeObserver(draw);
		observer.observe(canvas);
		return () => observer.disconnect();
	}, [samples, hover]);

	return (
		<canvas
			ref={canvasRef}
			className="chart"
			onMouseMove={e => onHover(indexAt.current(e.nativeEvent.offsetX))}
			onMouseLeave={() => onHover(null)}
		/>
	);
}
