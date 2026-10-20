// Same slug algorithm as index.html (cardSlug). Keep in sync.
export function cardSlug(s){
  return "nl:" + s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}
export function cardIds(cards){
  const seen = {};
  return cards.map(c=>{ let b = cardSlug(c[0]), id = b, n = 2; while(seen[id]) id = b + "-" + n++; seen[id] = 1; return id; });
}
