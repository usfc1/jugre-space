# JUGRE · Исторические космические аппараты

Набор GLB для 3D-конструктора. Модели сделаны процедурно по открытым схемам и фотографиям. Габариты и компоновка ориентированы на исторические аппараты, а крепёж, обшивка, мелкое оборудование и содержимое разрезов упрощены. Форма Дидима и Диморфа приближённая. Материалы встроены в GLB.

## Где искать сборки

| Миссия | Основные GLB в `models/assemblies/` |
| --- | --- |
| Artemis II | `artemis_ii_launch.glb` — SLS Block 1 с Orion Integrity, `orion_integrity.glb` — полётная конфигурация, `artemis_ii_icps_proximity.glb` — Orion рядом с ICPS |
| Mars 2020 | `perseverance_atlas_v_541.glb`, `perseverance_spacecraft.glb`, `perseverance_sky_crane.glb`, `perseverance.glb`, `perseverance_with_ingenuity.glb`, `ingenuity.glb` |
| Mars Science Laboratory | `curiosity_atlas_v_541.glb`, `curiosity_spacecraft.glb`, `curiosity_sky_crane.glb`, `curiosity.glb` |
| DART | `dart_falcon9_launch.glb`, `dart.glb`, `liciacube.glb`, `dart_liciacube_separation.glb`, `didymos_binary.glb` |
| Voyager 2 | `voyager_2_launch.glb` — Titan IIIE–Centaur с разгонным модулем, `voyager_2.glb` — зонд с раскрытыми штангами |
| Снабжение МКС | `cargo_dragon_falcon9_launch.glb`, `cargo_dragon_2.glb`, `iss.glb`, `dragon_iss_approach.glb`, `dragon_iss_docked.glb`, `dragon_harmony_detail.glb` |

МКС показана в конфигурации подхода CRS-35 к зенитному порту Harmony 15 октября 2026 года. В сборке есть шесть установленных iROSA, основной комплект из восьми крыльев и отдельный манипулятор Canadarm2. Отдельные Дидим и Диморф лежат в `models/components/`.

В `models/variants/` лежат состояния с отделёнными половинами обтекателей, сложенными или раскрытыми панелями, раскрытыми парашютами и учебными разрезами. Посадочные варианты Perseverance и Curiosity используют собственные версии перелётной и спускаемой ступеней. Общие элементы Falcon 9 и Atlas V 541 экспортированы один раз в `models/components/`.

## Интеграция

- `manifest.json` содержит пути и корневые идентификаторы, перечень ассетов по миссиям, габариты, шарниры и трансформации точек крепления. В Three.js после `GLTFLoader` устойчивый идентификатор узла доступен как `object.userData.partId`.
- Единицы — метры. Верх и продольная ось ракет идут вдоль `+Y`. Роверы смотрят вдоль `+Z`. У `mount_*` и `dock_port` локальная `+Z` направлена наружу. При стыковке совместите центры колец и направьте эти оси друг к другу.
- В `models/parts/` корень отдельной детали находится в её pivot. Поля `parent`, `translation` и `rotation` в манифесте восстанавливают исходное положение относительно родителя. В `mounts` и `bounds` координаты отсчитываются от корня соответствующего GLB. Кватернионы записаны как `[x, y, z, w]`.
- У узлов с `role = "hinge"` есть локальная ось вращения и угол текущего положения или раскрытия. Файлы содержат позы и шарниры. Ключевые кадры, физику полёта и параметры симуляции задаёт игра. Для ROSA, парашютов и телескопических ферм можно переключать геометрию по состоянию.

Повторный экспорт из каталога `source`:

```powershell
npm ci
npm run build
```

## Визуальные референсы

- Artemis II и компоновка SLS/Orion. [NASA, пресс-кит Artemis II](https://www.nasa.gov/artemis-ii-press-kit/) · [NASA, европейский служебный модуль](https://www.nasa.gov/reference/european-service-module/)
- Atlas V 541, Perseverance, Curiosity и Ingenuity. [ULA, схема Atlas V 541](https://www.ulalaunch.com/docs/default-source/launch-booklets/mars2020_mobrochure_200717.pdf) · [JPL, Mars 2020](https://www.jpl.nasa.gov/news/press_kits/mars_2020/launch/quick_facts/) · [NASA, стартовый комплект Curiosity](https://mars.nasa.gov/internal_resources/822/) · [NASA, приборы Curiosity](https://science.nasa.gov/mission/msl-curiosity/science-instruments/) · [JPL, Ingenuity](https://www.jpl.nasa.gov/missions/ingenuity/)
- DART, LICIACube, Дидим и Диморф. [NASA, аппарат DART](https://science.nasa.gov/blogs/dart/2021/11/24/the-dart-spacecraft/) · [NASA, технический отчёт DART](https://ntrs.nasa.gov/api/citations/20230015804/downloads/DART%20Final%20Technical%20Report.pdf) · [NASA, двойная система Дидима](https://science.nasa.gov/solar-system/asteroids/didymos/)
- Voyager 2 и носитель. [NASA, Voyager 2](https://science.nasa.gov/mission/voyager/voyager-2/) · [NASA, приборы Voyager](https://science.nasa.gov/mission/voyager/instruments/) · [NASA, схема Titan IIIE–Centaur](https://ntrs.nasa.gov/api/citations/19760019166/downloads/19760019166.pdf)
- Falcon 9, Dragon и МКС. [SpaceX, Falcon 9](https://www.spacex.com/rideshare/) · [SpaceX, Dragon](https://www.spacex.com/vehicles/dragon) · [NASA, подход CRS-35](https://www.nasa.gov/blogs/spacestation/2026/10/15/spacex-dragon-docks-with-science-supplies-and-roll-out-solar-arrays/) · [NASA, элементы МКС](https://www.nasa.gov/international-space-station/international-space-station-assembly-elements/)
