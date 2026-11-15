import { Box3, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';

export function partThumbnails(models) {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(128, 108);
  const scene = new Scene();
  scene.add(new HemisphereLight(0xe0efff, 0x6f6660, 2));
  const light = new DirectionalLight(0xffecd6, 2.2);
  light.position.set(4, 8, 6);
  scene.add(light);
  const camera = new PerspectiveCamera(35, 128 / 108, .01, 1000);
  const images = new Map();
  try {
    for (const [id, source] of models) {
      const model = source.clone(true);
      const bounds = new Box3().setFromObject(model);
      const center = bounds.getCenter(new Vector3());
      const radius = bounds.getSize(new Vector3()).length() / 2;
      camera.position.copy(center).addScaledVector(new Vector3(.8, .5, 1).normalize(), Math.max(.3, radius * 3.9));
      camera.lookAt(center);
      scene.add(model);
      renderer.render(scene, camera);
      images.set(id, renderer.domElement.toDataURL('image/png'));
      scene.remove(model);
    }
  } finally { renderer.dispose(); renderer.forceContextLoss(); }
  return images;
}
