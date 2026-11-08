export const missions = {
  apollo11: { name: 'Apollo 11', references: ['https://www.nasa.gov/wp-content/uploads/static/apollo50th/pdf/A11_PressKit.pdf', 'https://www.nasa.gov/history/diagrams/apollo.html'] },
  artemis_ii: { name: 'Artemis II', references: ['https://www.nasa.gov/reference/sls-space-launch-system-core-stage/', 'https://www.nasa.gov/reference/icps/', 'https://www.nasa.gov/reference/european-service-module/'] },
  mars_2020: { name: 'Mars 2020', references: ['https://www.ulalaunch.com/docs/default-source/launch-booklets/mars2020_mobrochure_200717.pdf', 'https://www.jpl.nasa.gov/news/press_kits/mars_2020/launch/quick_facts/'] },
  msl: { name: 'Mars Science Laboratory', references: ['https://mars.nasa.gov/internal_resources/822/', 'https://science.nasa.gov/mission/msl-curiosity/'] },
  dart: { name: 'DART', references: ['https://science.nasa.gov/blogs/dart/2021/11/24/the-dart-spacecraft/', 'https://www.spacex.com/assets/media/falcon-users-guide-2025-05-09.pdf'] },
  voyager_2: { name: 'Voyager 2', references: ['https://science.nasa.gov/mission/voyager/voyager-2/', 'https://science.nasa.gov/mission/voyager/instruments/', 'https://www.nasa.gov/wp-content/uploads/2025/06/tc-6-voyager-flight-data-report-1976.pdf'] },
  iss_resupply: { name: 'ISS / Cargo Dragon 2', references: ['https://www.spacex.com/vehicles/dragon', 'https://www.nasa.gov/international-space-station/international-space-station-assembly-elements/', 'https://www.nasa.gov/blogs/spacestation/2026/10/15/spacex-dragon-docks-with-science-supplies-and-roll-out-solar-arrays/'] },
};

export const names = (ru, en) => ({ ru, en });
export const apollo = ['apollo11'];
export const artemis = ['artemis_ii'];
export const atlas = ['mars_2020', 'msl'];
export const falcon = ['dart', 'iss_resupply'];
export const voyager = ['voyager_2'];

export const source = (id, pack = 'historical_spacecraft') => ({ id, pack });
const a = (id) => source(id, 'apollo11');
const h = (id) => source(id);

export const propellants = {
  kerolox: names('керосин и жидкий кислород', 'kerosene and liquid oxygen'),
  hydrolox: names('жидкий водород и жидкий кислород', 'liquid hydrogen and liquid oxygen'),
  titan_hypergolic: names('аэрозин-50 и тетраоксид диазота', 'Aerozine 50 and nitrogen tetroxide'),
  solid: names('твёрдое топливо', 'solid propellant'),
  rp1: names('керосин RP-1', 'RP-1 kerosene'),
  lox: names('жидкий кислород', 'liquid oxygen'),
  lh2: names('жидкий водород', 'liquid hydrogen'),
  aerozine50: names('аэрозин-50', 'Aerozine 50'),
  nto: names('тетраоксид диазота', 'nitrogen tetroxide'),
};

const liquidStage = (ref, program, label, diameter, base, engine, nodePattern, engineLabel, propellant, extra = {}) => (
  { ref, program, label, diameter, base, engine, nodePattern, engineLabel, propellant, ...extra }
);

export const stages = [
  liquidStage(a('s_ic'), apollo, 'Saturn V S-IC', 10.0584, 4.0, 'f1', /^s_ic\.f1_\d+$/, 'F-1', 'kerolox', {
    removed: /^s_ic\.(thrust_structure|engine_fairing_\d+)$/,
    vessels: { ref: a('s_ic_cutaway'), entries: [['rp1_tank', 'rp1'], ['lox_tank', 'lox']] },
  }),
  liquidStage(a('s_ii'), apollo, 'Saturn V S-II', 10.0584, 0, 'j2_sii', /^s_ii\.j2_\d+$/, 'J-2 · S-II', 'hydrolox', {
    removed: /^s_ii\.thrust_structure$/,
    vessels: { ref: a('s_ii_cutaway'), entries: [['lox_tank', 'lox'], ['lh2_tank', 'lh2']] },
  }),
  liquidStage(a('s_ivb'), apollo, 'Saturn V S-IVB', 6.604, 0, 'j2_sivb', /^s_ivb\.j2_\d+$/, 'J-2 · S-IVB', 'hydrolox', {
    removed: /^s_ivb\.aps_\d+$/,
    vessels: { ref: a('s_ivb_cutaway'), entries: [['lox_tank', 'lox'], ['lh2_tank', 'lh2']] },
  }),
  liquidStage(h('sls_core'), artemis, 'SLS Core', 8.41, 4.03, 'rs25', /^sls_core\.rs25_\d+$/, 'RS-25', 'hydrolox', {
    deck: 'forward_skirt', deckBase: 60.55,
    vessels: { ref: h('sls_core_cutaway'), entries: [['lh2', 'lh2'], ['lox', 'lox']] },
  }),
  liquidStage(h('icps'), artemis, 'SLS ICPS', 5.1, 4.79, 'rl10_icps', /^icps\.rl10$/, 'RL10C-2 · ICPS', 'hydrolox', {
    vessels: { ref: h('icps_cutaway'), entries: [['hydrogen', 'lh2'], ['oxygen', 'lox']] },
  }),
  liquidStage(h('atlas_v_core'), atlas, 'Atlas V CCB', 3.81, 3.94, 'rd180', /^atlas_v_core\.rd180$/, 'RD-180', 'kerolox', {
    vessels: { simple: [[1.77, 9.05, 'rp1'], [1.77, 16.94, 'lox']] },
  }),
  liquidStage(h('atlas_v_centaur'), atlas, 'Atlas V Centaur', 3.05, 3.84, 'rl10_atlas', /^atlas_v_centaur\.rl10_01$/, 'RL10 · Atlas V', 'hydrolox', {
    deck: 'equipment_deck', deckBase: 11.89, deckTop: 12.43, payloadAdapter: true,
    vessels: { simple: [[1.42, 4.76, 'lh2'], [1.42, 2.68, 'lox']] },
  }),
  liquidStage(h('falcon9_stage_1'), falcon, 'Falcon 9 S1', 3.66, 3.06, 'merlin_1d', /^falcon9_stage_1\.merlin_\d+$/, 'Merlin 1D', 'kerolox', {
    removed: /^falcon9_stage_1\.landing_leg_\d+$/,
    vessels: { simple: [[1.73, 13.9, 'rp1'], [1.73, 20.5, 'lox']] },
  }),
  liquidStage(h('falcon9_stage_2'), falcon, 'Falcon 9 S2', 3.66, 0.58, 'merlin_vac', /^falcon9_stage_2\.merlin_vac$/, 'Merlin Vacuum', 'kerolox', {
    deckBase: 13.42, payloadAdapter: true, vessels: { simple: [[1.71, 5.05, 'rp1'], [1.71, 7.0, 'lox']] },
  }),
  liquidStage(h('titan_stage_1'), voyager, 'Titan IIIE Stage I', 3.05, 2.95, 'lr87', /^titan_stage_1\.lr87_\d+$/, 'LR87', 'titan_hypergolic', {
    paired: true, vessels: { simple: [[1.39, 8.0, 'aerozine50'], [1.39, 10.7, 'nto']] },
  }),
  liquidStage(h('titan_stage_2'), voyager, 'Titan IIIE Stage II', 3.05, 1.94, 'lr91', /^titan_stage_2\.lr91$/, 'LR91', 'titan_hypergolic', {
    vessels: { simple: [[1.38, 2.68, 'aerozine50'], [1.38, 2.78, 'nto']] },
  }),
  liquidStage(h('titan_centaur'), voyager, 'Titan Centaur D-1T', 3.05, 2.86, 'rl10_titan', /^titan_centaur\.rl10_\d+$/, 'RL10 · Titan IIIE', 'hydrolox', {
    deck: 'equipment_deck', deckBase: 8.29, deckTop: 8.83, payloadAdapter: true,
    vessels: { simple: [[1.41, 3.23, 'lh2'], [1.41, 1.95, 'lox']] },
  }),
];

// Catalogue aliases preserve one copy per shared hardware type.
const item = (id, ref, program, category, ru, en, mount, extra = {}) => (
  { id, ref, program, category, name: names(ru, en), mount, ...extra }
);
export const existing = [
  item('saturn_instrument_unit', a('instrument_unit'), apollo, 'control', 'Приборное кольцо Saturn V', 'Saturn V Instrument Unit', { stack: 6.604 }),
  item('columbia_command_module', a('apollo_cm'), apollo, 'control', 'Командный модуль Columbia', 'Columbia command module', { aft: 3.9116 }),
  item('columbia_service_module', a('apollo_sm_stowed'), apollo, 'payload', 'Служебный модуль Columbia', 'Columbia service module', { stack: 3.9116 }),
  item('columbia_csm', a('columbia_csm'), apollo, 'payload', 'Columbia в сборе', 'Complete Columbia CSM', { aft: 3.9116, y: 0 }, { ready: true }),
  item('eagle_lunar_module', a('eagle_lm'), apollo, 'payload', 'Лунный модуль Eagle', 'Eagle lunar module', { cargo: true }, { ready: true }),
  item('saturn_ic_ii_interstage', a('interstage_1_2'), apollo, 'separation', 'Межступенчатая секция S-IC / S-II', 'S-IC / S-II interstage', { stack: 10.0584 }),
  item('saturn_ii_ivb_interstage', a('interstage_2_3'), apollo, 'separation', 'Межступенчатая секция S-II / S-IVB', 'S-II / S-IVB interstage', { aft: 10.0584, forward: 6.604 }),
  item('saturn_sla_adapter', a('sla'), apollo, 'structure', 'Адаптер SLA', 'SLA adapter', { aft: 6.604, forward: 3.9116 }),
  item('saturn_sla_panel', a('sla.panel_01'), apollo, 'separation', 'Створка SLA', 'SLA panel', { legacy: true }),
  item('saturn_ic_fin', a('s_ic.engine_fairing_01.fin'), apollo, 'surface', 'Киль S-IC', 'S-IC fixed fin', { radial: true }),
  item('saturn_ic_engine_fairing', a('s_ic.engine_fairing_01'), apollo, 'structure', 'Обтекатель двигателя S-IC', 'S-IC engine fairing', { radial: true }, { strip: /\.fin$/ }),
  item('saturn_ivb_aps', a('s_ivb.aps_01'), apollo, 'engine', 'Блок ориентации S-IVB', 'S-IVB APS pod', { radial: true }),
  item('apollo_sps', a('apollo_sm.sps'), apollo, 'engine', 'Маршевый двигатель SPS', 'Apollo SPS engine', { engine: 'apollo_sps' }),
  item('eagle_dps', a('eagle_descent.dps'), apollo, 'engine', 'Посадочный двигатель DPS', 'Eagle descent engine DPS', { engine: 'eagle_dps' }),
  item('eagle_aps', a('eagle_ascent.aps'), apollo, 'engine', 'Взлётный двигатель APS', 'Eagle ascent engine APS', { engine: 'eagle_aps' }),
  item('columbia_high_gain', a('apollo_sm.high_gain_antenna'), apollo, 'payload', 'Антенна Columbia', 'Columbia high-gain antenna', { radial: true }),

  item('orion_command_module', h('orion_cm'), artemis, 'control', 'Командный модуль Orion', 'Orion crew module', { aft: 5.02 }),
  item('orion_service_module', h('orion_esm_stowed'), artemis, 'payload', 'Служебный модуль Orion', 'Orion European Service Module', { aft: 5.10, forward: 4.86 }),
  item('orion_integrity', h('orion_integrity'), artemis, 'payload', 'Orion Integrity в сборе', 'Complete Orion Integrity', { aft: 5.10 }, { ready: true }),
  item('sls_lvsa_adapter', h('lvsa'), artemis, 'structure', 'Переходник SLS LVSA', 'SLS LVSA adapter', { aft: 8.41, forward: 5.10 }),
  item('sls_osa_adapter', h('osa'), artemis, 'separation', 'Переходник Orion OSA', 'Orion Stage Adapter', { stack: 5.10 }),
  item('sls_srb_booster', h('sls_srb_l'), artemis, 'engine', 'Твердотопливный ускоритель SLS', 'SLS solid rocket booster', { booster: true }, { propellant: 'solid' }),
  item('sls_srb_nozzle', h('sls_srb_l.nozzle'), artemis, 'engine', 'Сопло ускорителя SLS', 'SLS booster nozzle', { engine: 'sls_srb_nozzle' }),
  item('orion_esm_main_engine', h('orion_esm.main_engine'), artemis, 'engine', 'Маршевый двигатель Orion', 'Orion ESM main engine', { engine: 'orion_esm_main' }),
  item('orion_solar_wing', h('orion_esm.wing_01'), artemis, 'surface', 'Солнечное крыло Orion', 'Orion solar wing', { radial: true }),
  item('orion_solar_wing_stowed', h('orion_esm_stowed'), artemis, 'surface', 'Солнечное крыло Orion сложено', 'Orion solar wing stowed', { radial: true }, { node: 'orion_esm.wing_01', variantOf: 'orion_solar_wing', pose: 'stowed' }),
  item('orion_saj_panel', h('esm_fairing_01'), artemis, 'separation', 'Защитная панель Orion SAJ', 'Orion SAJ shroud panel', { legacy: true }),
  item('orion_las_tower', h('orion_las'), artemis, 'separation', 'Система аварийного спасения Orion', 'Orion launch abort system', { legacy: true }),

  item('atlas_centaur_interstage', h('atlas_v_interstage'), atlas, 'separation', 'Межступенчатый адаптер Atlas V', 'Atlas V Centaur interstage adapter', { aft: 3.81, forward: 3.05 }),
  item('atlas_boattail', h('atlas_v_boattail'), atlas, 'structure', 'Основание обтекателя Atlas V', 'Atlas V fairing boattail', { aft: 3.81, forward: 5.4, fairingReceiver: 'atlas' }),
  item('atlas_fairing_left', h('atlas_v_fairing_l'), atlas, 'separation', 'Левая створка Atlas V', 'Atlas V left fairing half', { fairing: ['atlas', 'left'] }),
  item('atlas_fairing_right', h('atlas_v_fairing_r'), atlas, 'separation', 'Правая створка Atlas V', 'Atlas V right fairing half', { fairing: ['atlas', 'right'] }),
  item('atlas_srb_booster', h('atlas_v_srb_01'), atlas, 'engine', 'Твердотопливный ускоритель Atlas V', 'Atlas V solid rocket booster', { booster: true }, { propellant: 'solid' }),
  item('atlas_srb_nozzle', h('atlas_v_srb_01.nozzle'), atlas, 'engine', 'Сопло ускорителя Atlas V', 'Atlas V booster nozzle', { engine: 'atlas_srb_nozzle' }),
  item('sky_crane_engine', h('mars_descent_stage.landing_engines_01.mle_01'), atlas, 'engine', 'Посадочный двигатель Sky Crane', 'Sky Crane landing engine', { engine: 'sky_crane_mle' }),
  item('sky_crane_propellant_tank', h('mars_descent_stage.propellant_tank_01'), atlas, 'tank', 'Бак спускаемой ступени', 'Descent-stage propellant tank', { legacy: true }),
  item('mars_cruise_solar_panel', h('mars_cruise_stage.solar_panel_01'), atlas, 'surface', 'Солнечная панель перелётной ступени', 'Cruise-stage solar panel', { radial: true }),
  item('perseverance_rover', h('perseverance'), ['mars_2020'], 'payload', 'Perseverance в сборе', 'Complete Perseverance rover', { cargo: true }, { ready: true, vehicle: 'rover' }),
  item('curiosity_rover', h('curiosity'), ['msl'], 'payload', 'Curiosity в сборе', 'Complete Curiosity rover', { cargo: true }, { ready: true, vehicle: 'rover' }),
  item('perseverance_rover_stowed', h('perseverance_spacecraft'), ['mars_2020'], 'payload', 'Perseverance со сложенной мачтой', 'Perseverance with mast stowed', { cargo: true },
    { node: 'perseverance', strip: /^ingenuity$/, variantOf: 'perseverance_rover', pose: 'stowed' }),
  item('curiosity_rover_stowed', h('curiosity_spacecraft'), ['msl'], 'payload', 'Curiosity со сложенной мачтой', 'Curiosity with mast stowed', { cargo: true },
    { node: 'curiosity', variantOf: 'curiosity_rover', pose: 'stowed' }),
  item('ingenuity_rotorcraft', h('ingenuity'), ['mars_2020'], 'payload', 'Ingenuity в сборе', 'Complete Ingenuity rotorcraft', { cargo: true }, { ready: true, vehicle: 'rotorcraft' }),
  item('perseverance_entry_package', h('perseverance_spacecraft'), ['mars_2020'], 'payload', 'Perseverance в перелётно-посадочном блоке', 'Perseverance cruise and entry package', { cargo: true }, { ready: true, vehicle: 'cruisePackage' }),
  item('curiosity_entry_package', h('curiosity_spacecraft'), ['msl'], 'payload', 'Curiosity в перелётно-посадочном блоке', 'Curiosity cruise and entry package', { cargo: true }, { ready: true, vehicle: 'cruisePackage' }),

  item('falcon9_interstage_shell', h('falcon9_interstage'), falcon, 'separation', 'Межступенчатая секция Falcon 9', 'Falcon 9 interstage', { stack: 3.66, radialHosts: /\.grid_fin_\d+$/ }, { strip: /\.grid_fin_\d+$/ }),
  item('falcon9_grid_fin', h('falcon9_interstage.grid_fin_01'), falcon, 'surface', 'Решётчатый руль Falcon 9', 'Falcon 9 grid fin', { radial: true }),
  item('falcon9_grid_fin_deployed', h('falcon9_booster_landing'), falcon, 'surface', 'Решётчатый руль Falcon 9 раскрыт', 'Falcon 9 grid fin deployed', { radial: true }, { node: 'falcon9_interstage.grid_fin_01', variantOf: 'falcon9_grid_fin', pose: 'deployed' }),
  item('falcon9_landing_leg', h('falcon9_stage_1.landing_leg_01'), falcon, 'structure', 'Посадочная опора Falcon 9', 'Falcon 9 landing leg', { radial: true }),
  item('falcon9_fairing_left', h('falcon9_fairing_l'), ['dart'], 'separation', 'Левая створка Falcon 9', 'Falcon 9 left fairing half', { fairing: ['falcon', 'left'] }),
  item('falcon9_fairing_right', h('falcon9_fairing_r'), ['dart'], 'separation', 'Правая створка Falcon 9', 'Falcon 9 right fairing half', { fairing: ['falcon', 'right'] }),
  item('dart_spacecraft_bus', h('dart_bus'), ['dart'], 'control', 'Платформа аппарата DART', 'DART spacecraft bus', { cargo: true, radialHosts: /\.mount_(rosa_l|rosa_r|draco|rlsa|propulsion)$/ }),
  item('dart_draco_camera', h('dart_draco'), ['dart'], 'payload', 'Камера DRACO', 'DRACO camera', { radial: true }),
  item('dart_rlsa_antenna', h('dart_rlsa'), ['dart'], 'payload', 'Антенна RLSA аппарата DART', 'DART RLSA antenna', { radial: true, normal: [0, -1, 0] }),
  item('dart_next_c', h('dart_propulsion.next_c'), ['dart'], 'engine', 'Ионный двигатель NEXT-C', 'NEXT-C ion thruster', { radial: true, normal: [0, 0, 1] }),
  item('dart_hydrazine_thrusters', h('dart_propulsion.hydrazine_cluster_01'), ['dart'], 'engine', 'Блок двигателей ориентации DART', 'DART attitude thruster cluster', { radial: true, normal: [0, 0, 1] }),
  item('dart_rosa_left', h('dart_rosa_l'), ['dart'], 'surface', 'Левое крыло ROSA', 'Left ROSA wing', { radial: true }),
  item('dart_rosa_right', h('dart_rosa_r'), ['dart'], 'surface', 'Правое крыло ROSA', 'Right ROSA wing', { radial: true }),
  item('dart_rosa_left_rolled', h('dart_rosa_l_rolled'), ['dart'], 'surface', 'Левое крыло ROSA свёрнуто', 'Left ROSA wing rolled', { radial: true }, { variantOf: 'dart_rosa_left', pose: 'stowed' }),
  item('dart_rosa_right_rolled', h('dart_rosa_r_rolled'), ['dart'], 'surface', 'Правое крыло ROSA свёрнуто', 'Right ROSA wing rolled', { radial: true }, { variantOf: 'dart_rosa_right', pose: 'stowed' }),
  item('dart_deployer', h('dart_liciacube_mount'), ['dart'], 'separation', 'Контейнер выпуска LICIACube', 'LICIACube deployer', { legacy: true }),
  item('dart_impact_probe', h('dart_stowed'), ['dart'], 'payload', 'DART в транспортной конфигурации', 'DART launch configuration', { cargo: true }, { ready: true, vehicle: 'probe' }),
  item('dart_impact_probe_deployed', h('dart'), ['dart'], 'payload', 'DART с раскрытыми ROSA', 'DART with ROSA deployed', { cargo: true }, { variantOf: 'dart_impact_probe', pose: 'deployed' }),
  item('liciacube_satellite', h('liciacube_stowed'), ['dart'], 'payload', 'Спутник LICIACube', 'LICIACube satellite', { cargo: true }, { ready: true, vehicle: 'satellite' }),
  item('liciacube_satellite_deployed', h('liciacube'), ['dart'], 'payload', 'LICIACube с раскрытыми панелями', 'LICIACube with deployed panels', { cargo: true }, { variantOf: 'liciacube_satellite', pose: 'deployed' }),

  item('titan_srb_booster', h('titan_srb_l'), voyager, 'engine', 'Твердотопливный ускоритель Titan IIIE', 'Titan IIIE solid rocket booster', { booster: true }, { propellant: 'solid' }),
  item('titan_srb_nozzle', h('titan_srb_l.nozzle'), voyager, 'engine', 'Сопло ускорителя Titan IIIE', 'Titan IIIE booster nozzle', { engine: 'titan_srb_nozzle' }),
  item('titan_centaur_fairing_left', h('titan_centaur_fairing_l'), voyager, 'separation', 'Левая створка Titan Centaur', 'Titan Centaur left fairing half', { fairing: ['titan', 'left'] }),
  item('titan_centaur_fairing_right', h('titan_centaur_fairing_r'), voyager, 'separation', 'Правая створка Titan Centaur', 'Titan Centaur right fairing half', { fairing: ['titan', 'right'] }),
  item('voyager_kick_stage', h('voyager_injection_stage'), voyager, 'engine', 'Разгонный блок Voyager', 'Voyager injection stage', { stack: 1.65 }, { propellant: 'solid' }),
  item('voyager_spacecraft_bus', h('voyager_bus'), voyager, 'control', 'Приборный корпус Voyager', 'Voyager equipment bus', { cargo: true, radialHosts: /\.mount_(hga|rtg|mag|radio|scan|record)$/ }),
  item('voyager_scan_head', h('voyager_scan_platform'), voyager, 'payload', 'Сканирующая платформа Voyager', 'Voyager scan platform', { radial: true }),
  item('voyager_rtg_assembly', h('voyager_rtg_boom'), voyager, 'payload', 'Штанга с тремя РИТЭГ Voyager', 'Voyager boom with three RTGs', { radial: true }),
  item('voyager_high_gain', h('voyager_hga'), voyager, 'payload', 'Главная антенна Voyager', 'Voyager high-gain antenna', { radial: true, normal: [0, -1, 0] }),
  item('voyager_mag_boom', h('voyager_mag_boom'), voyager, 'surface', 'Раскрываемая штанга магнитометров Voyager', 'Voyager deployable magnetometer boom', { radial: true }),
  item('voyager_mag_boom_stowed', h('voyager_mag_boom_stowed'), voyager, 'surface', 'Штанга магнитометров Voyager сложена', 'Voyager magnetometer boom stowed', { radial: true },
    { variantOf: 'voyager_mag_boom', pose: 'stowed' }),
  item('voyager_radio_whips', h('voyager_radio_antennas'), voyager, 'surface', 'Раскрываемые штыревые антенны Voyager', 'Voyager deployable radio whips', { radial: true }),
  item('voyager_probe', h('voyager_2_stowed'), voyager, 'payload', 'Voyager 2 в транспортной конфигурации', 'Voyager 2 launch configuration', { cargo: true }, { ready: true, vehicle: 'probe' }),
  item('voyager_probe_deployed', h('voyager_2'), voyager, 'payload', 'Voyager 2 с раскрытыми штангами', 'Voyager 2 with deployed booms', { cargo: true }, { variantOf: 'voyager_probe', pose: 'deployed' }),

  item('dragon_pressure_capsule', h('dragon_capsule'), ['iss_resupply'], 'control', 'Грузовая капсула Dragon 2', 'Dragon 2 cargo capsule', { aft: 4.0 }),
  item('dragon_draco', h('dragon_draco.cluster_01.nozzle_01'), ['iss_resupply'], 'engine', 'Двигатель ориентации Draco', 'Draco attitude thruster', { radial: true, normal: [0, 1, 0] }),
  item('dragon_trunk', h('dragon_trunk'), ['iss_resupply'], 'structure', 'Грузовой отсек Dragon', 'Dragon unpressurized trunk',
    { stack: 4.0, radialHosts: /\.fin_\d+$/, socket: { profile: 'heritage_dragon_trunk_solar', y: 0.14, receiver: true } }, { strip: /\.(body_solar_array|fin_\d+)$/ }),
  item('dragon_body_solar_array', h('dragon_trunk.body_solar_array'), ['iss_resupply'], 'surface', 'Солнечная обшивка Dragon', 'Dragon body-mounted solar array',
    { socket: { profile: 'heritage_dragon_trunk_solar', y: 0 } }),
  item('dragon_trunk_fin', h('dragon_trunk.fin_01'), ['iss_resupply'], 'surface', 'Киль грузового отсека Dragon', 'Dragon trunk fin', { radial: true }),
  item('cargo_dragon_vehicle', h('cargo_dragon_closed'), ['iss_resupply'], 'payload', 'Cargo Dragon 2 в сборе', 'Complete Cargo Dragon 2', { aft: 4.0 }, { ready: true }),
  item('cargo_dragon_vehicle_open', h('cargo_dragon_2'), ['iss_resupply'], 'payload', 'Cargo Dragon 2 со стыковочным портом', 'Cargo Dragon 2 with docking port exposed', { aft: 4.0 },
    { variantOf: 'cargo_dragon_vehicle', pose: 'dock' }),
  item('dragon_docking_ring', h('dragon_dock'), ['iss_resupply'], 'structure', 'Стыковочное кольцо Dragon', 'Dragon docking ring', { legacy: true }),
  item('iss_solar_wing', h('iss_arrays.p4_alpha_joint.wing_aft'), ['iss_resupply'], 'surface', 'Солнечное крыло МКС', 'ISS solar array wing', { legacy: true }),
  item('iss_harmony_port', h('iss_harmony_dock'), ['iss_resupply'], 'destination', 'Модуль Harmony и порты', 'Harmony module and ports', { legacy: true }),
  item('iss_station', h('iss'), ['iss_resupply'], 'destination', 'МКС в сборе', 'Complete ISS', { legacy: true }),
];
