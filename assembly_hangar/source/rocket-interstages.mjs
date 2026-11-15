import { Quaternion } from 'three';

// Fictional integrated separators. The open sleeve drops with the spent stage.
const definitions = [
  ['is_125', 'IS-125', 1.25, 2.15, 145],
  ['is_250', 'IS-250', 2.5, 2.95, 340],
];

export const interstages = Object.fromEntries(definitions.map(([id, code, diameterM, heightM, massKg]) => {
  const profile = diameterM === 1.25 ? 'jugre_stack_125' : 'jugre_stack_250';
  const forward = new Quaternion(0, Math.SQRT1_2, Math.SQRT1_2, 0).toArray();
  const aft = new Quaternion(Math.SQRT1_2, 0, 0, Math.SQRT1_2).toArray();
  return [id, { id, code, name: `Interstage`, group: 'structure', massKg,
    detail: `Stage separation · Ø ${diameterM} m`, dimensionsM: [diameterM + .06, heightM, diameterM + .06],
    stats: { mountDiameterM: diameterM, heightM, staging: 'integratedInterstage' },
    mounts: {
      [`${id}.mount_aft`]: { profile, attachmentRole: 'structure', translation: [0, 0, 0], rotation: aft },
      [`${id}.mount_forward`]: { profile, attachmentRole: 'structure', translation: [0, heightM, 0], rotation: forward },
      [`${id}.mount_engine`]: { profile, attachmentRole: 'engineReceiver', translation: [0, heightM, 0], rotation: aft },
    },
  }];
}));

export const twoStageExample = [
  { key: 'lower', part: 'b_240_rezerv' },
  { key: 'lower-engine', part: 'k_420_kedr', parent: 'lower', socket: 'mount_aft', plug: 'mount_engine' },
  { key: 'adapter', part: 'p_2512_konus', parent: 'lower', socket: 'mount_forward', plug: 'mount_forward' },
  { key: 'interstage', part: 'is_125', parent: 'adapter', socket: 'mount_aft', plug: 'mount_aft' },
  { key: 'upper-engine', part: 'k_155v_dalniy', parent: 'interstage', socket: 'mount_engine', plug: 'mount_engine' },
  { key: 'upper', part: 'b_32_stvol', parent: 'interstage', socket: 'mount_forward', plug: 'mount_aft' },
  { key: 'upper-tank', part: 'b_32_stvol', parent: 'upper', socket: 'mount_forward', plug: 'mount_aft' },
  { key: 'command', part: 'pb_1_strizh', parent: 'upper-tank', socket: 'mount_forward', plug: 'mount_aft' },
  { key: 'rack', part: 'pn_1_polka', parent: 'command', socket: 'mount_forward', plug: 'mount_aft' },
];
