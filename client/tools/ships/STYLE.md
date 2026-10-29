# Stilregeln für Neubauten (Clean Toon)

Referenz ist die Iron Dreadnought (`fleet/iron_dreadnought.py`): wenige, große, klare Formen, flache Farbflächen in drei
Tönen, harte Schlagschatten, dunkle Konturen, ein paar leuchtende Akzente. Alle 15 Schiffe sind in diesem Stil gebaut;
vor einem Umbau die Kontaktbögen ansehen (`preview.py -- --views board,hero,behind --sheet`).

## Arbeitsweise

- Ein Umbau ändert nur `fleet/<id>.py`. Neue Helfer kommen in dieses Modul; erst wenn ein zweites Schiff sie braucht,
  wandern sie nach `parts.py`. `parts.py`, `vf.py` und `palette.py` ändert nur, wer die gemeinsamen Dateien betreut, und
  vergleicht dabei alle Schiffe vor und nach der Änderung (Dreiecke, Maße, GLB-Bytes bzw. Positionen). Braucht ein Schiff
  eine Variante eines gemeinsamen Helfers, kopiert es ihn ins Modul. Fehlt eine Farbe in `palette.py`, kommt sie vorerst
  als benannte Konstante ins Modul und wird gemeldet.
- `build()` beginnt mit `m = vf.materials(s.name, "<klasse>")` und endet mit `return s.finish()`.
- Gemeinsame Helfer in `parts.py`: Baugruppen `turret`, `engine` (`n` Segmente für kleine Düsen), `badge` (Wappenplatte
  der Flaggschiffe), `trim_loop`, `trim_line`, `on_surface`; Formen `sym` (symmetrischer Umriss aus einer Hälfte),
  `stealth` (Tarnkappenprofil), `block` (Facettenblock auf Lagen), `beam` (kantige Strebe), `axle` (Walze entlang X),
  `ring_at` (Querschnitt eines Lofts, für Bänder, die dem Rumpf folgen).
- Vor einem Umbau die jetzige Fassung rendern und die Bilder wegkopieren (die Vorschau überschreibt `renders/<id>/`).
- Kreislauf: `build.py -- <id>` (Dreiecke, KB, Warnungen) und `preview.py -- <id> --views board,zoom,behind,hero,wreck`,
  bei asymmetrischen Schiffen auch `enemy_zoom`. Fertig ist ein Schiff erst ohne Warnungen und nach dem Blick auf `board`
  in voller Größe (unten).

## Was wegfällt

Alles, was auf dem Brett nur Pixelrauschen ist: Plattenfugen, Bevel, Texturen, Greebles, Lüfter, Rohrleitungen,
Flak-Türmchen, Raketenwerfer, Radarplatten, Schüsseln, Sensorkuppeln und Bauchsensoren, Radiatoren, Fensterreihen aus
Einzelkästen, Antennen mit Scheiben, Kühlrippen und Ringe an Düsen und Läufen, Nebentürme. Ausnahme: Ein solches Teil
ist das Kennzeichen des Schiffs (die Schüssel des Signal Boosters, die Arme der Repair Drone); dann bleibt es, aber groß
und grob.

## Was größer und gröber wird

- Hauptwaffen: weniger und größer. Bei der Dreadnought drei Zwillingstürme (Radius 0,42 → 0,5 bzw. 0,46) statt vier großer
  und zwei kleiner, Bugkanonen mit Lauf-Radius 0,24 statt 0,17, ein Kühlmantel statt drei Ringen, große Mündungsbremse.
- Aufbauten aus zwei bis drei Blöcken (`vf.wedge`, schräge Front), ein durchgehendes Fensterband (`window`) statt
  Fensterreihen, ein Mast als einfacher Stab mit einem Licht.
- Emitter als flache Kuppeln am Deckrand statt Kugeln auf Stielen; kleine, hoch stehende Teile werfen fleckige Schatten.
- Düsen mit `parts.engine` (Gehäuse, Glocke, leuchtende Brennkammer, keine Rippen).
- Große leere Flächen bekommen einen groben Bruch (Stufe, zweite Plattenlage, Lichtband), keine Kleinteile. Die Unterseite
  braucht Kiel oder Schürzen, sonst ist die Karte (`hero`, von schräg unten) leer.

## Mindestgröße bei Brettgröße

Auf dem Brett ist eine Blender-Einheit etwa 22 px (Flaggschiffe 24 px), die Konturen sind 0,7–1,8 px breit.

- Formteile, die als Fläche mit Tönen gelesen werden sollen: kleinste Abmessung mindestens 0,15 (≈ 3 px), besser 0,2.
- Rohre und Läufe: Durchmesser mindestens 0,18. Leisten dünner als 0,15 nur, wenn sie mindestens 0,8 lang sind.
- Lichter dürfen kleiner sein, weil sie leuchten: Punktlichter ab Radius 0,08, Lichtbänder ab 0,04 dick und 0,5 lang.
- Zwischen zwei Teilen mindestens 0,1 Luft, sonst verschmelzen ihre Konturen zu einem schwarzen Fleck.

## Palette und Akzent

`vf.materials` liefert alles; Farben stehen zentral in `palette.py` und kommen nie als Hex in ein Schiffsmodul.

- `hull` für den Rumpf und die großen Flächen, `armor` (je Klasse einen Hauch heller als der Rumpf, auch beim hellen
  Rumpf der Unterstützer) für aufgesetzte Lagen wie Schürzen und Kasematten, `dark` für Gehäuse, Verschlüsse, Barbetten,
  Kiel. Hell-Dunkel-Wechsel zwischen Lagen macht die Form.
- `accent` nur für das, was die Klasse zeigt (bei der Dreadnought die Türme): etwa ein Zehntel bis ein Fünftel der
  sichtbaren Fläche. Klassen: Jäger koralle mit orangen Lichtern, Kreuzer kornblumenblau mit blauen, Schlachtschiffe
  stahlblau mit kühlem Blau, Unterstützer mint mit grünen Lichtern und hellem Rumpf. Flaggschiffe: Akzent im Farbton des
  Admirals, `signal` (exakt die UI-Farbe, ohne Glühen) für Kennzeichen, `trim` (Gold, etwa 0,07 breit) als Zierlinie
  entlang des Rumpfs, `glow` und `core` in der Admiralsfarbe.
- `steel` für Läufe und Düsenglocken, `glass` für Kanzeln. Lichter sparsam und mit Absicht: Brennkammern (`core`), ein
  Mastlicht, ein bis zwei Lichtbänder (`glow`), je Brücke ein Fensterband; Sonderlichter aus der Palette über `vf.light`
  (etwa `palette.SHIELD`, `palette.PLASMA`).
- Sonderfarben einzelner Schiffe stehen in `palette.py`: Rost und Schrottgrau (Scrap Raider), Messing (Pendulum),
  Warnstreifen (Repair Drone), Cyan (Signal Booster), Violett der Drohne, `PHANTOM` (Tarnrumpf der Mirage).

## Normalen

Rund oder eckig entscheidet das Material: eckig (`hull`, `armor`, `dark`, `accent`, `trim`) gibt einen Ton je Facette, rund
(`hull_round`, `armor_round`, `dark_round`, `accent_round`, `steel`, `glass`) saubere Bänder; Kanten über 38° bleiben immer
hart, Bevel gibt es nicht. Rohre, Türme, Barbetten, Masten, Düsen und runde Rümpfe also rund, Kisten, Platten, Keil- und
Facettenrümpfe eckig. Nie einen runden Rumpf eckig (Facettenstreifen) und nie einen Keilrumpf rund (Verläufe quer über
die Facetten).

## Dreiecksbudget

Obergrenzen: Schlachtschiffe 7k, Kreuzer 5k, Jäger und Unterstützer 4k, Drohne 2k, Trugbild 1,5k, Flaggschiffe 8k. Die
Werft liegt heute bei 0,9k (Trugbild) bis 6,5k (Dreadnought). Das meiste geht in runde Teile: große mit 20–24
Segmenten, kleine mit 12–16 (`parts.engine(…, n=12)`), `smooth` mit `subdiv` 1–2.

## Silhouette und Wiedererkennbarkeit

Jedes Schiff muss auf dem Brett an Umriss und Akzentfarbe erkennbar bleiben: Länge, Breite und Höhe bleiben bei einem
Umbau (±10 %), ebenso die Grundform des Rumpfs, die Anordnung der Hauptmerkmale und die Zahl der Düsen. Die Bastion ist
mit 6,3 Einheiten das breiteste Schiff (im Spiel 2,07 bei Slots im Abstand 2,2); breiter darf kein Flaggschiff werden.
Kennzeichen bleiben und werden eher größer:

| Schiff           | Kennzeichen                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| void_interceptor | Nadelnase, runder Rumpf, Klingenflügel mit Vorderkantenstreifen, V-Leitwerk, Gondeln unter den Flügeln                       |
| scrap_raider     | asymmetrisch: Rammsporn, Kanzel steuerbord, schwere Kanonengondel backbord, Stummelflügel, drei ungleiche Düsen, Rostflicken |
| horizon_cruiser  | lang und schlank, flacher Bug mit Turm, Brückenturm achtern, zwei Gondeln an Pylonen, Heckflossen                            |
| plasma_frigate   | gedrungen, Plasmakanone als Bug mit leuchtenden Ringen, vier Gondeln mit Leuchtringen, Reaktorwulst                          |
| titan_carrier    | Flugdeck mit Landebahnlichtern, Insel achtern, Hangars an den Flanken, violetter Reaktorkern im Bug                          |
| drone            | kleiner Keil mit Pfeilflügeln, violettes Sensorauge statt Kanzel, zwei Düsen                                                 |
| repair_drone     | runder Körper mit grünem und orangem Band, gefaltete Arme oben, Schweißarm, Seitengondeln                                    |
| signal_booster   | große Schüssel auf Gabelmast mit Cyan-Rand, Signalring um den Rumpf, Relaismasten, Solarpaneele                              |
| bastion          | fliegende Festung: gewölbte Schildwand am Bug, Terrassendecks, vier Schildpylone, Bergfried, drei schwere Düsen              |
| vanguard         | Rammbug als Speerspitze mit leuchtenden Schneiden, zwei Bugkanonen, gepfeilte Panzerklingen, zwei Türme, Düsencluster        |
| hive             | Zwei-Kammer-Rumpf, leuchtende Brutwaben auf dem Rücken, Hangar-Sponsons mit Drohnen, Sechseckturm                            |
| mirage           | flach, facettiert, dunkler Rumpf mit türkisen Nähten, zwei schräge Projektorflossen, Diamantflügel                           |
| pendulum         | Railgun als Rückgrat mit Spulen weit über den Bug, Gimbal aus Messing-Zahnkranz und Spulenring, Pendel unter dem Kiel        |
| decoy            | Hologramm eines Mirage-Jägers aus Flächen (`hologram`) und leuchtenden Kanten, wenige Dreiecke                               |

## Fallen

- **Dunkle Unterseite in der Karte:** `hero` schaut von schräg unten. Unterseiten liegen dort im Halbschatten oder
  Schatten, dunkle Materialien (`dark`, `PHANTOM`) versinken im dunklen Grund. Unterseite in `hull` oder `armor` halten,
  mit Kiel oder Plattenlage brechen; eigene dunkle Töne brauchen einen nicht zu dunklen Schatten-Ton (wie `PHANTOM`).
- **Kennzeichen oben:** Die Standard-Kartenkamera kommt von schräg unten und versteckt alles, was auf dem Deck liegt.
  Solche Schiffe bekommen in `look.HERO_SHIPS` eine Kartenkamera von vorn oben mit eigenem Licht (Deck hell, Flanke
  halbhell): heute Titan Carrier (Flugdeck, Insel), Hive (Waben), Bastion (Terrassen, Bergfried, Pylone statt nur der
  Bugwand). Die Pendulum nutzt die Standardansicht von schräg unten, passend zu den übrigen Schiffskarten.
- **Weiße Ringflächen:** Runde Materialien mit Glanzpunkt (`steel`, `accent_round`, `glass`, Messing) auf großen ebenen
  Flächen wie Stirnseiten von Rohren oder Ringscheiben überschreiten in `hero` als Ganzes die Glanzschwelle und leuchten
  weiß. Große ebene Flächen bekommen ein Material ohne Glanz (`dark_round`, `hull_round` oder die eckige Variante).
- **Wappen:** Sie müssen in `behind` (zweite Spielkamera, von hinten oben) aufrecht stehen und dürfen von keinem Turm,
  Mast oder Aufbau verdeckt sein; das Oben des Zeichens zeigt deshalb zum Bug. Von der Seite (`board`) sieht man das nicht.
- **Große Lichter:** Große Lichtelemente (Signalring, Leuchtband über die halbe Schiffslänge) dürfen `vf.light(…,
  glow=False)` nehmen: exakt die Farbe, aber ohne Glühen, damit ein kleines Licht der Blickfang bleibt.
- **Gegnerseite:** Gegner stehen um 180° gedreht, man sieht ihre Steuerbordseite; das Licht ist wie im Spiel je Seite
  gespiegelt, kommt also auch bei ihnen von vorn (`enemy`, `enemy_zoom`). Asymmetrische Schiffe dort prüfen.
- **Feste Bauergebnisse:** Ein Bau muss bei jedem Lauf dieselben Bytes liefern. bmesh-Operatoren wie `solidify` ordnen
  ihre Ausgabe je Lauf anders an (`vf.dish` fängt das ab); wer solche Operatoren im Modul nutzt, baut zweimal und vergleicht.
- Die Freestyle-Meldung „strokes set empty“ ist harmlos: Eine Linienart hat in der Ansicht nichts zu zeichnen, etwa die
  Außenkontur eines kleinen Schiffs, das in `behind` ganz vor seinem Pad liegt.

## Regeln, die `build.py` prüft

- `lifted`: Kein Teil unter dem Slot, Blender-z −1,4, bei Flaggschiffen −1,27 (sie werden im Spiel um 1,1 vergrößert).
  Sonst das ganze Schiff mit `s.lift(dz)` anheben.
- Keine schwebenden Teile: Jedes Teil berührt, schneidet oder steckt in einem anderen (`vf.loose_parts`, Lücken unter 0,03
  zählen als Berührung).
- Geschlossene Hüllen: Die Materialien sind einseitig (nur Hologramme beidseitig), jedes Teil muss also geschlossen und
  nach außen orientiert sein, auch an den Wrackstücken (`vf.bad_shells`). Die Primitive aus `vf.py` erfüllen das von
  selbst, gespiegelte Teile auch; Gefahr droht bei eigenen offenen Lofts (`cap_start`/`cap_end`), umgedrehten Flächen
  und negativer Skalierung.
- Budget und Größe stehen in der Ausgabe (Dreiecke, KB, Maße).

## Prüfung im `board`-Render

`renders/<id>/board.png` in voller Größe ansehen, nicht vergrößert, am besten neben der Dreadnought:

1. Umriss und Klasse sind sofort lesbar, die Kennzeichen aus der Tabelle sind zu sehen.
2. Keine Linienklumpen: Wo Konturen zu schwarzen Flecken verschmelzen, ist ein Teil zu klein oder zu dicht.
3. Deck hell, Flanke halbhell, Schatten fallen nach achtern; keine fleckigen Schatten kleiner Teile.
4. Lichter sind Akzente, keine Flächen; der Akzent ist zu sehen, ohne zu dominieren.
5. Danach `zoom` (keine leeren Flächen, keine schwebenden Teile), `behind` (Wappen, Aufbauten), `enemy` (Steuerbordseite)
   und `hero` (Kartenvorlage, Unterseite nicht leer, keine weißen Flächen).
