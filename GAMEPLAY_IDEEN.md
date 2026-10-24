# Gameplay-Ideen für Voidfleet

> Die ursprüngliche Analyse bezieht sich auf den Code-Stand `e7a974a`. Reparaturdrohne und Signalverstärker wurden anschließend in `abebbf5` auf `main` implementiert; die Aussagen zu ihren fehlenden Fähigkeiten beschreiben den früheren Stand.

**Ich würde Voidfleet stärker um Positionierung, das Lesen des Gegners und gezielte Gegenmaßnahmen bauen.** Jede Runde sollte eine Entscheidung enthalten wie: „Greife ich seine Schwachstelle an – oder rechne ich damit, dass er genau das absichert?“

Im Code sehe ich dafür einige konkrete Ansatzpunkte. Meine Prioritäten wären:

1. **Die vorhandenen Karten zu echten taktischen Werkzeugen machen.**

   Die beschriebenen Schiffsfähigkeiten sind aktuell noch nicht umgesetzt. Reparaturdrohne, Signalverstärker und Träger verlieren dadurch einen großen Teil ihrer Identität. Das erklärt aus meiner Sicht bereits einiges vom eintönigen Spielgefühl. Siehe [aktueller Serverstatus](server/AGENTS.md).

   Außerdem sollten Befehle auf das Schiff anwendbar sein, das man gerade ausspielt. Die [Zugprüfung](server/src/match.ts) verhindert das momentan. **Schiff und Befehl könnten dadurch viel stärker als gemeinsamer Zug funktionieren:** einen Angreifer sofort überladen, eine wichtige Verstärkung abschirmen oder eine Formation gezielt ergänzen.

2. **Positionierung jede Runde verfügbar machen.**

   Ein begrenztes Grundmanöver sollte fest zum Zug gehören. Momentan benötigt Bewegung eine passende Karte und verbraucht den einzigen Befehl. Dadurch ist sie stark von der Hand abhängig.

   Ein verlässliches Manöver schafft wiederkehrende Entscheidungen: ein beschädigtes Schiff retten, Deckung herstellen, eine andere Position dafür öffnen. Besondere Bewegungskarten könnten zusätzliche Vorteile bieten, etwa Feuerbereitschaft nach dem Manöver oder Schutz beim Rückzug.

   Das wäre für mich der wichtigste neue Baustein.

3. **Befehle stärker auf den vermuteten gegnerischen Plan ausrichten.**

   Ein Teil der Angriffe sollte gewählte Positionen bedrohen. Dazu passende Gegenmaßnahmen könnten sein: **Sperrfeuer bestraft Bewegung, Durchbruch bedroht gedeckte Schiffe, ein Köder lenkt einen Angriff um.** Solche Reaktionen werden gemeinsam mit dem Zug geplant und automatisch aufgelöst – das passt zum asynchronen Ablauf.

   Damit Entscheidungen begründet bleiben, sollten ausgespielte Befehle und relevante Bedrohungen gut sichtbar sein. Sensorscan könnte zusätzliche Informationen über verfügbare Optionen liefern.

   Genau diese Verbindung aus verdeckter Wahl, Gegenmaßnahmen und situationsabhängigen Vorteilen beschreibt auch David Sirlin für [Yomi](https://www.sirlin.net/articles/designing-yomi). Für Voidfleet würde ich sie über Schiffe und Positionen ausdrücken.

4. **Schiffsklassen und Lanes mit deutlicheren Vor- und Nachteilen versehen.**

   Aktuell können Kampfschiffe aus beiden Lanes grundsätzlich mit voller Stärke feuern, während Command zusätzlich Deckung bieten kann. Ich würde testen, ob **Strike mehr unmittelbare Feuerkraft und Command bessere Unterstützung** bietet. Artillerieschiffe könnten eine bewusst gewählte Ausnahme sein.

   Ohne Mana lassen sich starke Fähigkeiten gut durch andere Kosten begrenzen: einen Angriff aussetzen, Deckung verlassen oder eine Runde sichtbar aufladen. Ein schweres Schiff mit angekündigtem Angriff erzeugt eine Bedrohung, um die beide Spieler planen können.

   Reparatur würde ich beispielsweise an einen gelungenen Rückzug koppeln. So entsteht eine taktische Kombination; dauerhafte automatische Heilung könnte die Gefechte weiter verlängern.

5. **Früher interessante Brettzustände erreichen.**

   Als separate Variante würde ich **zwei gewählte Startschiffe und maximal sechs Schiffe pro Seite** testen. Damit beginnen Partien bereits mit einer kleinen Formation, und einzelne Positionen bleiben leichter lesbar.

   Pauschal den Schaden zu erhöhen wäre angesichts der aktuellen Niederlagebedingung heikel: Schon der Verlust des einzigen Kampfschiffs beendet die Partie, auch wenn noch Verstärkung auf der Hand liegt.

Beim unmittelbaren Spielgefühl gibt es zusätzlich einen einfachen Hebel: **„Normal“ verdoppelt derzeit die Animationsdauer**, und Schüsse laufen einzeln nacheinander. Kürzere Standardanimationen und überlappende Salven könnten deutlich helfen. Siehe [Animationseinstellungen](client/src/settings.ts) und [Rundenwiedergabe](client/src/roundPlayback.ts).

**Mein erster Prototyp wäre bewusst klein:** Schiffsfähigkeiten aktivieren, Befehle auf neu ausgespielte Schiffe erlauben und anschließend Grundmanöver plus zwei passende Angriff-/Konterkarten testen. Entscheidend wäre für mich, ob Spieler danach regelmäßig mehrere plausible Züge sehen und erfolgreiche Vorhersagen des Gegners als Höhepunkte der Partie erleben.

## Beispiel: Derselbe Angriff, drei unterschiedliche Entscheidungen

Dieses Beispiel überträgt die interaktive Darstellung in Text. Es zeigt eine vorgeschlagene Regel und einen vereinfachten Ausschnitt der Auflösung.

Die gegnerische Fregatte steht mit **3 HP und 3 ATK in Strike / Slot 3**. Dein verdeckt geplanter Befehl ist ein **Torpedo mit 4 Schaden auf diesen Slot**. Er wirkt nach Bewegung und Schutz; sein Ziel bleibt der gewählte Slot.

Das vorgeschlagene Grundmanöver erlaubt, ein Schiff zu versetzen. Dafür feuert dieses Schiff in der laufenden Runde nicht.

| Vorab geplanter Zug des Gegners | Ergebnis gegen den Torpedo | Abwägung |
| --- | --- | --- |
| Stellung halten | Die Fregatte wird vor dem Kampf zerstört. | Falls du einen anderen Befehl gespielt hättest, hätte der Gegner seinen Angriff und seine Manöveroption behalten. |
| Nach Slot 4 ausweichen | Der Torpedo trifft den leeren Slot 3. Die Fregatte behält 3 HP. | Die Fregatte verzichtet auf ihren Angriff – auch dann, wenn du gar keinen Torpedo gespielt hättest. |
| Notschilde einsetzen | 3 Schild absorbieren den Großteil des Schadens. Die Fregatte behält 2 HP und kann noch feuern. | Der Gegner hat seinen einzigen Befehl für Schutz eingesetzt. |

**Beide Pläne werden vor dem Aufdecken festgelegt.** Weitere Angriffe sind in diesem Beispiel ausgeblendet. Die Zahlen dienen als Vorschlag für einen Prototyp.
