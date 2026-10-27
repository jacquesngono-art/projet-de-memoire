import { PREFERENCE_CATALOG } from '../constants/preferences.js';

/**
 * Parseur heuristique (sans IA) d'une requête immobilière en langage naturel.
 *
 * Deux rôles :
 *  1. Repli quand Mistral est indisponible / lent : la recherche continue de
 *     fonctionner au lieu de renvoyer une erreur.
 *  2. Court-circuit : si la requête est simple et reconnue avec un score élevé,
 *     on évite complètement l'appel réseau à Mistral (~1-2 s économisées).
 */

const CITIES = [
  'Yaoundé', 'Douala', 'Bafoussam', 'Bamenda', 'Garoua', 'Kribi', 'Buea', 'Limbe',
  'Bertoua', 'Maroua', 'Ngaoundéré', 'Ebolowa', 'Kumba', 'Dschang', 'Edea',
  'Nkongsamba', 'Bafia', 'Yagoua', 'Foumban', 'Mbouda',
];

const DISTRICTS = [
  'Bastos', 'Bonas', 'Ngoa-Ekellé', 'Ngoa Ekelle', 'Mvan', 'Ekie', 'Mfandena',
  'Omnisport', 'Etoudi', 'Tsinga', 'Ekounou', 'Mvog-Mbi', 'Mvog-Ada', 'Briqueterie',
  'Mokolo', 'Nlongkak', 'Essos', 'Mendong', 'Odza', 'Awae', 'Emana', 'Nkolbisson',
  'Nsimeyong', 'Damas', 'Nkol-Eton',
  'Bonapriso', 'Akwa', 'Bonanjo', 'Bonamoussadi', 'Deido', 'New Bell',
  'Bepanda', 'Logbaba', 'Makepe', 'Bonaberi', 'Ndokoti',
];

const TYPES = ['appartement', 'studio', 'chambre', 'villa', 'terrain', 'bureau', 'magasin', 'entrepôt', 'maison'];

// Mots-clés -> code de préférence
const PREFERENCE_KEYWORDS = {
  lycee: ['lycée', 'lycee'],
  ecole: ['école', 'ecole', 'primaire', 'maternelle'],
  universite: ['université', 'universite', 'campus', 'fac'],
  creche: ['crèche', 'creche', 'garderie'],
  hopital: ['hôpital', 'hopital', 'clinique', 'centre de santé', 'dispensaire'],
  pharmacie: ['pharmacie'],
  centre_ville: ['centre-ville', 'centre ville', 'centre'],
  marche: ['marché', 'marche '],
  supermarche: ['supermarché', 'supermarche', 'superette', 'supérette'],
  transport: ['transport', 'gare', 'arrêt', 'arret', 'bus', 'taxi', 'station'],
  banque: ['banque', 'atm', 'distributeur'],
  commissariat: ['commissariat', 'police', 'gendarmerie'],
  mosquee: ['mosquée', 'mosquee'],
  eglise: ['église', 'eglise', 'paroisse'],
  espace_vert: ['parc', 'espace vert', 'jardin public'],
  salle_sport: ['salle de sport', 'gym', 'fitness'],
};

function normalize(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_']/g, ' ')    // tirets/apostrophes → espace ("mvog-mbi" = "mvog mbi")
    .replace(/(.)\1+/g, '$1')  // lettres doublées : "ekelle" → "ekele"
    .replace(/\s+/g, ' ')
    .trim();
}

function findPreferenceCodes(text) {
  const haystack = normalize(text);
  const found = new Set();
  for (const [code, keywords] of Object.entries(PREFERENCE_KEYWORDS)) {
    for (const kw of keywords) {
      if (haystack.includes(normalize(kw).trim())) {
        found.add(code);
        break;
      }
    }
  }
  return [...found];
}

/** "moins de 50 millions" -> 50000000 ; "300k" -> 300000 */
function parseAmount(raw, unit) {
  const n = Number(raw.replace(/[^\d.]/g, '').replace(/\s/g, ''));
  if (!Number.isFinite(n)) return null;
  if (unit && /million/i.test(unit)) return Math.round(n * 1_000_000);
  if (unit && /^\s*k/i.test(unit)) return Math.round(n * 1_000);
  // Un prix immobilier au Cameroun < 1000 est forcément en millions
  return n < 1000 ? Math.round(n * 1_000_000) : Math.round(n);
}

/**
 * Analyse une requête et renvoie des critères partiels.
 * @returns {{criteria: Object, confidence: number}}
 *   confidence : 0 → rien reconnu, 1 → très sûr.
 */
export function heuristicParse(message) {
  const text = message || '';
  const low = normalize(text);
  const criteria = {
    type: null,
    city: null,
    district: null,
    near: null,
    preferences: [],
    bedroomsMin: null,
    bathroomsMin: null,
    priceMin: null,
    priceMax: null,
    sortBy: null,
    radiusKm: null,
  };
  let signals = 0;

  // On retire d'abord les expressions de quantité ("3 chambres", "2 douches")
  // pour ne pas confondre le NOMBRE de pièces avec un TYPE de bien.
  const typeText = low.replace(
    /\d+\s*(chambres?|pieces?|pi[eè]ces?|salles?\s+de\s+bain|douches?|sdb)/g,
    ' '
  );

  // Type de bien (le plus long d'abord pour que "appartement" ne soit pas
  // écrasé par "maison")
  for (const t of [...TYPES].sort((a, b) => b.length - a.length)) {
    const needle = normalize(t);
    // Frontière de mot : évite que "chambre" matche dans "chambre froide"
    const re = new RegExp(`(^|[^a-z0-9])${needle}s?([^a-z0-9]|$)`);
    if (re.test(typeText)) {
      criteria.type = t;
      signals++;
      break;
    }
  }

  // Ville
  for (const city of CITIES) {
    if (low.includes(normalize(city))) {
      criteria.city = city;
      signals++;
      break;
    }
  }

  // Quartier
  for (const d of DISTRICTS) {
    if (low.includes(normalize(d))) {
      criteria.district = d.replace('Ngoa Ekelle', 'Ngoa-Ekellé');
      signals++;
      break;
    }
  }

  // Chambres : "3 chambres", "3 pièces"
  const bedrooms = low.match(/(\d+)\s*(chambres?|pieces?|pièces?|ch\b)/);
  if (bedrooms) {
    criteria.bedroomsMin = Number(bedrooms[1]);
    signals++;
  }

  // Douches / salles de bain
  const baths = low.match(/(\d+)\s*(douches?|salles? de bain|sdb)/);
  if (baths) {
    criteria.bathroomsMin = Number(baths[1]);
    signals++;
  }

  // Prix maximum : "moins de 50 millions", "max 300k", "< 80m"
  const maxMatch = low.match(/(?:moins de|max(?:imum)?|<|sous)\s*([\d\s.,]+)\s*(millions?|m\b|k)?/);
  if (maxMatch) {
    const v = parseAmount(maxMatch[1], maxMatch[2]);
    if (v) {
      criteria.priceMax = v;
      signals++;
    }
  }
  // Prix minimum : "plus de 20 millions", "au moins 50m"
  const minMatch = low.match(/(?:plus de|au moins|min(?:imum)?|>)\s*([\d\s.,]+)\s*(millions?|m\b|k)?/);
  if (minMatch) {
    const v = parseAmount(minMatch[1], minMatch[2]);
    if (v) {
      criteria.priceMin = v;
      signals++;
    }
  }

  // Tri par prix
  if (/moins (cher|chère)|pas cher|petit budget|economique|économique/.test(low)) {
    criteria.sortBy = 'price_asc';
    signals++;
  }

  // Préférences de proximité
  const prefs = findPreferenceCodes(text);
  if (prefs.length > 0) {
    criteria.preferences = prefs;
    signals++;
  }

  // "près de X" / "proche de X" → lieu repère + rayon
  const nearMatch = low.match(/(?:pres de|proche de|a cote de|pas loin de|autour de)\s+([^,.;]+)/);
  if (nearMatch) {
    criteria.radiusKm = 5;
    // Si le lieu repère correspond à un quartier/ville déjà détecté, on ne
    // duplique pas dans "near" (sinon on garde le texte brut pour le géocodage)
    if (!criteria.district && !criteria.city) {
      criteria.near = nearMatch[1].trim();
    }
    signals++;
  }

  // Score de confiance : au moins 2 signaux pour court-circuiter Mistral
  const confidence = Math.min(1, signals / 3);
  return { criteria, confidence, signals };
}

/**
 * Détection locale (sans IA) d'un message HORS recherche : salutations,
 * remerciements, questions d'usage ou charabia clavier ("dddddd").
 * Filet de sécurité de l'orchestrateur : un tel message ne doit JAMAIS
 * déclencher une recherche de biens.
 */
const SEARCH_VERBS = /cherche|trouve|montre|propose|besoin|recherche|location|louer|acheter|achete|vendre|vends?|estim|prix|quartier|dispo|annonce|logement|maison|villa|studio|appartement|terrain|chambre|bureau/;

export function isSmallTalk(message) {
  const text = (message || '').trim();
  if (!text) return true;
  const low = normalize(text);
  // Charabia : une même lettre répétée (ex "ddddd", "aaaaaaa")
  const letters = low.replace(/[^a-z]/g, '');
  if (letters.length >= 5 && /^(.)\1+$/.test(letters)) return true;
  // Aucun critère immobilier reconnu ET aucun verbe d'intention de recherche
  const { signals } = heuristicParse(text);
  if (signals > 0) return false;
  if (SEARCH_VERBS.test(low)) return false;
  return true;
}

/** Préférences connues, exposées pour la validation côté Mistral. */
export const KNOWN_PREFERENCE_CODES = PREFERENCE_CATALOG.map((p) => p.code);

export default heuristicParse;
