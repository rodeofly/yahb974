// Un scénario fictif. Les indicateurs servent à démontrer les règles, pas à noter un élève.
export const sampleGraph = {
  version: 1,
  title: "L’île des possibles",
  start: "depart",
  description: "Un livre-jeu de démonstration : observer, croiser des indices et justifier ses choix. Paysage librement inspiré de La Réunion ; données et situations fictives.",
  nodes: [
    {id:"depart",title:"Le carnet retrouvé",kind:"départ",x:-27,z:19,body:"Un carnet de recherche est arrivé au village. Il manque sa conclusion. Ta mission : traverser l’île, recueillir des indices et expliquer ce que tu peux réellement en déduire.\n\nChaque lieu est un sommet du graphe. Chaque choix ouvre un chemin. Tu peux demander de l’aide et revenir sur une décision."},
    {id:"lagon",title:"Observer avant de conclure",kind:"observation",x:-29,z:2,body:"Au bord du lagon, ton carnet contient deux relevés fictifs : 24 °C à l’ombre et 31 °C au soleil. Les mesures ont été prises au même moment avec deux instruments différents.\n\nQuelle phrase décrit les données sans aller au-delà de ce qu’elles montrent ?"},
    {id:"atelier",title:"L’atelier des indices",kind:"aide",x:-18,z:-15,body:"Une observation décrit ce qui a été relevé. Une explication cherche pourquoi. Avec ces deux mesures, on constate une différence de 7 °C ; on ne peut pas encore isoler la cause.\n\nPour comparer correctement, on pourrait utiliser le même instrument et répéter les mesures. Retourne au lagon pour reprendre ton choix."},
    {id:"belvedere",title:"Le belvédère des hypothèses",kind:"choix",x:-5,z:-27,body:"Tu as distingué une observation d’une explication. Depuis le belvédère, deux pistes s’offrent à toi.\n\nLa forêt permet de croiser un second indice. Le refuge permet de faire le point immédiatement. Ces chemins ont des coûts différents, mais le plus court n’est pas forcément le plus utile pour apprendre."},
    {id:"foret",title:"Croiser les indices",kind:"raisonnement",x:18,z:-16,body:"Un second carnet présente trois comparaisons réalisées avec le même instrument : 24/30 °C, 25/31 °C et 24/29 °C (ombre/soleil). Ces valeurs sont inventées pour l’activité.\n\nLes trois observations vont dans le même sens. Elles renforcent une hypothèse, tout en laissant des limites à discuter."},
    {id:"refuge",title:"Le refuge des idées",kind:"bilan",x:0,z:-1,body:"Prends un moment pour organiser tes idées. Une observation a été recueillie au lagon ; un second indice peut être examiné dans la forêt.\n\nLe passage vers le volcan demande au moins un point d’observation et un point de raisonnement. La règle est visible : rien n’est décidé au hasard."},
    {id:"observatoire",title:"Le détour qui aide",kind:"aide",x:17,z:5,body:"Dire « toujours » à partir de quelques observations est trop fort. Une conclusion utile précise les données, ce qu’elles suggèrent et ce qu’il faudrait encore vérifier.\n\nCe détour est une boucle de remédiation. Il te ramène au défi sans te retirer de points."},
    {id:"volcan",title:"La preuve avant la conclusion",kind:"défi",x:27,z:19,body:"Au pied du volcan, il faut compléter la dernière page du carnet.\n\nQuelle conclusion respecte les observations et leurs limites ? Tu peux revenir au refuge pour relire tes indices avant de répondre."},
    {id:"arrivee",title:"Ton histoire, ton parcours",kind:"arrivée",x:0,z:27,body:"Le carnet est complété. Tu as parcouru une histoire en faisant des choix et en utilisant les indices disponibles.\n\nOuvre le journal pour raconter ton chemin : quelles décisions as-tu prises ? Un détour t’a-t-il aidé ? Le graphe permet de comparer les parcours sans réduire l’apprentissage à leur longueur."}
  ],
  edges: [
    {id:"e01",source:"depart",target:"lagon",label:"Ouvrir le carnet et rejoindre le lagon",weight:1},
    {id:"e02",source:"lagon",target:"belvedere",label:"Les deux mesures diffèrent de 7 °C",weight:2,condition:{variable:"observation",op:"lt",value:1},effects:{observation:1,score:10}},
    {id:"e03",source:"lagon",target:"belvedere",label:"Les deux mesures diffèrent de 7 °C",weight:2,condition:{variable:"observation",op:"gte",value:1}},
    {id:"e04",source:"lagon",target:"atelier",label:"Le soleil explique forcément toute la différence",weight:1},
    {id:"e05",source:"lagon",target:"atelier",label:"Demander un indice",weight:1},
    {id:"e06",source:"atelier",target:"lagon",label:"Revenir aux observations",weight:1},
    {id:"e07",source:"belvedere",target:"foret",label:"Chercher un second indice dans la forêt",weight:3},
    {id:"e08",source:"belvedere",target:"refuge",label:"Prendre le raccourci vers le refuge",weight:1},
    {id:"e09",source:"foret",target:"refuge",label:"Relier les deux séries d’observations",weight:2,condition:{variable:"raisonnement",op:"lt",value:1},effects:{raisonnement:1,score:10}},
    {id:"e10",source:"foret",target:"refuge",label:"Relier les deux séries d’observations",weight:2,condition:{variable:"raisonnement",op:"gte",value:1}},
    {id:"e11",source:"refuge",target:"foret",label:"Examiner ou relire le second indice",weight:2},
    {id:"e12",source:"refuge",target:"volcan",label:"Accéder au défi du volcan",weight:3,condition:{all:[{variable:"observation",op:"gte",value:1},{variable:"raisonnement",op:"gte",value:1}]}},
    {id:"e13",source:"volcan",target:"arrivee",label:"Les relevés soutiennent l’hypothèse ; d’autres vérifications restent utiles",weight:2,effects:{raisonnement:1,autonomie:1,score:20}},
    {id:"e14",source:"volcan",target:"observatoire",label:"Ces relevés prouvent que ce sera toujours vrai partout",weight:1},
    {id:"e15",source:"volcan",target:"refuge",label:"Revenir au refuge pour relire les indices",weight:2},
    {id:"e16",source:"observatoire",target:"volcan",label:"Reprendre le défi avec cet indice",weight:1}
  ]
};
