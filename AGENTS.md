# Voidfleet

Das ist Voidfleet, ein asynchroner PvP-Deckbuilder, der im Science-Fiction-Weltraum-Universum spielt. Der Spieler befehligt eine Flotte aus Raumschiffen. Schiffe werden auf das Spielbrett (zwei Lanes pro Seite: Strike und Command) gelegt und mit Befehlen unterstützt, zum Beispiel Angriff, Reparieren, Schilde aufladen. Schiffe und Befehle werden jeweils als Karte mit unterschiedlichen Werten dargestellt und kommen aus zwei getrennten Decks.

Das Besondere an Voidfleet ist der asynchrone Spielmodus mit Simultaneous Blind Play: Beide Spieler wählen ihren Zug gleichzeitig und blind, ohne Timer — ein Zug darf beliebig lange dauern. Ein Zug besteht aus bis zu 1 Schiff (in Runde 1 zwei), 1 Befehl und einem Grundmanöver: Ein Schiff auf dem Brett wechselt in einen freien Slot, in der anderen oder derselben Lane, und feuert dafür in dieser Runde nicht. Sobald beide submitted haben, wird aufgedeckt und in festen Phasen aufgelöst (Deploy → Manöver → Effects → Combat → Cleanup). Verloren hat, wer weder auf dem Brett noch auf der Hand ein Kampfschiff hat; ab Runde 8 bekommen alle Kampfschiffe Overdrive (+1 ATK, alle 4 Runden einen mehr), damit Partien nicht im Patt enden. Es gibt kein Energie-/Mana-System.

## Status

Wir sind momentan noch in der Entwicklungsphase. Das Spiel ist also nicht live. Aus diesem Grund können wir den Code jederzeit komplett ändern und es ist nicht notwendig, defensiven Code, Kompatibilitätslayer oder Sonstiges zu implementieren. Wir müssen also keine Rücksicht auf Legacy Code nehmen, sondern können den Code so einfach, schlank und elegant wie möglich halten. 
