import MistralService from './MistralService.js';
import AdService from './AdService.js';
import GeocodingService from './GeocodingService.js';
import InteractionModel from '../models/InteractionModel.js';
import { heuristicParse, isSmallTalk } from '../utils/queryHeuristics.js';
import { resolveDistrict, resolveCity } from '../utils/placeResolver.js';

/**
 * Distance Haversine en km entre deux points (lat/lon en degrés).
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Classe les biens par proximité du lieu repère géocodé : le plus proche
 * d'abord (le plus "sur"), puis de moins en moins proche. Ajoute distanceKm
 * à chaque bien pour l'afficher dans le tableau du chat.
 */
function sortByProximity(results, geo) {
  if (!geo || typeof geo.latitude !== 'number' || typeof geo.longitude !== 'number') {
    return results;
  }
  return results
    .map((r) => {
      const lat = Number(r.latitude);
      const lon = Number(r.longitude);
      if (!isNaN(lat) && !isNaN(lon)) {
        return {
          ...r,
          distanceKm: Math.round(haversineKm(geo.latitude, geo.longitude, lat, lon) * 10) / 10,
        };
      }
      return r;
    })
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}

/**
 * Fusionne deux jeux de résultats en dédupliquant par ad_id.
 * Les biens du premier tableau (résultats géolocalisés, plus pertinents)
 * apparaissent en premier ; le tri par pertinence est donc préservé.
 */
function mergeResults(primary, secondary) {
  const seen = new Set();
  const out = [];
  for (const list of [primary, secondary]) {
    for (const item of list || []) {
      const key = item.ad_id || item.id;
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
  }
  return out;
}

/**
 * Service de l'agent virtuel IA.
 *
 * Flux :
 * 1. L'utilisateur envoie un prompt en langage naturel ("cherche moi une maison
 *    proche du lycée de Ngoa-Ekellé avec 3 chambres").
 * 2. Le backend transmet le prompt à Mistral AI (résultat mis en cache 5 min).
 * 3. Mistral renvoie un JSON structuré (type, ville, quartier, préférences...).
 * 4. Le backend géocode le lieu repère et interroge la base (en parallèle).
 * 5. Mistral formate une réponse conversationnelle avec les résultats.
 */
export const AgentAIService = {
  async searchByNaturalLanguage(userMessage, userId = null) {
    // 1. Conversion du prompt en critères JSON via Mistral (mis en cache 5 min)
    const criteria = await MistralService.parseSearchQuery(userMessage);

    // ── Garde-fou conversationnel ──
    // Un message hors recherche (salutation "comment allez-vous", remerciement,
    // charabia "ddddd") ne doit JAMAIS déclencher une recherche : avant ce fix,
    // aucun critère n'était reconnu → le repli "Yaoundé par défaut" retournait
    // les 124 biens de la ville à n'importe quel message.
    // Double détection : intention de Mistral (prompt) + heuristique locale
    // (couvre le vieux cache sans "intent" et l'IA indisponible).
    if (criteria.intent === 'small_talk' || isSmallTalk(userMessage)) {
      const response = await MistralService.buildSmallTalkResponse(userMessage);
      console.log(`[Agent] Message hors recherche détecté → réponse conversationnelle.`);
      return {
        criteria,
        results: [],
        response,
        count: 0,
        geocoded: false,
        geo: null,
        relaxed: null,
        explanation: criteria.explanation || null,
      };
    }

    // "lycée d'Ekounou" : Mistral met parfois le lieu dans `near` sans
    // remplir `district` → la recherche filtrerait toute la ville. Si `near`
    // contient un quartier/ville connu, on l'extrait comme garde-fou.
    if (criteria.near && !criteria.district && !criteria.city) {
      const { criteria: h } = heuristicParse(criteria.near);
      if (h.district) criteria.district = h.district;
      else if (h.city) criteria.city = h.city;
    }

    // Résolution canonique : "ngoa ekele" → "Ngoa-Ekellé", "yaounde" →
    // "Yaoundé". Sans ça, un tiret/accent différent fait échouer le ILIKE
    // et la relaxation retourne toute la ville (le bug vu en prod).
    if (criteria.district) {
      const d = await resolveDistrict(criteria.district);
      if (d) criteria.district = d;
    }
    if (criteria.city) {
      const c = await resolveCity(criteria.city);
      if (c) criteria.city = c;
    }
    // "a cote de ngoa ekele" : si `near` est en fait un quartier connu, on le
    // met aussi dans `district` — double filet (texte + rayon géocodé).
    if (criteria.near && !criteria.district) {
      const d = await resolveDistrict(criteria.near);
      if (d) criteria.district = d;
    }

    // "proche du lycée de X" : `near` peut être posé sans `radiusKm` par
    // l'IA → on applique un rayon par défaut (3 km) pour géocoder le repère.
    const effectiveRadius = criteria.radiusKm || (criteria.near ? 3 : null);

    // Concentration Yaoundé : si la requête ne contient AUCUN repère
    // géographique (pas de ville, quartier ni lieu), on restreint la recherche
    // à Yaoundé — la base de démonstration est centrée dessus.
    const noGeo = !criteria.city && !criteria.district && !criteria.near;
    if (noGeo) criteria.city = 'Yaoundé';

    // Critères transmis au moteur SQL (on retire les champs non-SQL)
    const { near, radiusKm, explanation, ...sqlCriteria } = criteria;
    const wantsGeo = Boolean(near && effectiveRadius);

    // 2. Géocodage du lieu repère ET recherche par ville/quartier EN PARALLÈLE.
    //    Avant : géocodage (~1 s) puis recherche (~200 ms) en séquentiel.
    //    Maintenant : les deux partent ensemble, la latence perçue est celle
    //    du plus lent au lieu de la somme.
    const [geo, baseResults] = await Promise.all([
      wantsGeo ? GeocodingService.geocodeLandmark(near) : Promise.resolve(null),
      AdService.search(sqlCriteria),
    ]);

    let results = baseResults;
    let searchCriteria = sqlCriteria;
    let relaxed = null;

    // Relaxation progressive : si 0 résultat, on retire d'abord le `type`
    // (le critère le plus souvent trop restrictif, ex: "appartement" dans un
    // quartier où il n'y a que des maisons), puis le `district`.
    if (results.length === 0 && sqlCriteria.type) {
      const { type, ...withoutType } = sqlCriteria;
      results = await AdService.search(withoutType);
      if (results.length > 0) {
        searchCriteria = withoutType;
        relaxed = 'type';
      }
    }
    if (results.length === 0 && sqlCriteria.district) {
      const { type, district, ...withoutDistrict } = sqlCriteria;
      results = await AdService.search(withoutDistrict);
      if (results.length > 0) {
        searchCriteria = withoutDistrict;
        relaxed = relaxed ? 'type+district' : 'district';
      }
    }

    // 3. Si le lieu repère a pu être géocodé (ex: "entrée BEAC" → coordonnées
    //    Yaoundé), les résultats = UNIQUEMENT les biens dans le rayon autour du
    //    repère. On ne fusionne plus avec les résultats "partout au pays" —
    //    c'est ce qui rendait "chambre à côté de l'entrée BEAC" imprécis.
    //    Repli : si le rayon est vide, on garde les résultats de base.
    if (geo) {
      searchCriteria = {
        ...searchCriteria,
        centerLat: geo.latitude,
        centerLon: geo.longitude,
        radius: effectiveRadius,
      };
      const nearResults = await AdService.search(searchCriteria);
      if (nearResults.length > 0) {
        results = nearResults;
      } else {
        console.log(`[Agent] Rayon ${effectiveRadius} km autour de "${near}" vide — repli sur les résultats de base.`);
      }
    }

    // 4. Enregistre l'interaction si l'utilisateur est connecté.
    //    Écritures en parallèle (au lieu d'une boucle await séquentielle).
    if (userId && results.length > 0) {
      await Promise.all(
        results.slice(0, 5).map((r) =>
          InteractionModel.recordView({ userId, adId: r.ad_id }).catch(() => {})
        )
      );
    }

    // Classe les résultats par proximité du lieu repère géocodé (le plus
    // proche/sur d'abord) et ajoute distanceKm à chaque bien pour que le
    // front puisse afficher la distance dans le tableau.
    const rankedResults = sortByProximity(results, geo);

    // 5. Réponse conversationnelle formatée par Mistral.
    //    Si des critères ont été relâchés, on le précise dans le contexte pour
    //    que l'IA puisse dire "j'ai élargi la recherche".
    const criteriaForResponse = relaxed
      ? { ...criteria, _relaxed: relaxed }
      : criteria;
    const response = await MistralService.buildSearchResponse(userMessage, results, criteriaForResponse);

    return {
      criteria,
      results: rankedResults,
      response,
      count: rankedResults.length,
      // Indique au front si la recherche a été restreinte à un rayon géographique
      geocoded: Boolean(geo),
      // Centre géocodé du lieu repère (pour trier par proximité côté client)
      geo: geo
        ? { latitude: geo.latitude, longitude: geo.longitude, displayName: geo.displayName || null }
        : null,
      // Critères relâchés (ex: "type", "type+district") si recherche élargie
      relaxed,
      explanation: explanation || null,
    };
  },

  async generateAdDescription(data) {
    return MistralService.generateAdDescription(data);
  },

  /**
   * Recherche par image : décrit d'abord ce que l'IA voit dans l'image,
   * extrait les caractéristiques du bien, cherche en base des biens similaires,
   * et renvoie une réponse conversationnelle complète.
   */
  async searchByImage(images, userId = null) {
    // 1. Description détaillée de l'image via vision IA
    const imageDescription = await MistralService.analyzeImage(images,
      "Décris cette image immobilière en détail en français : type de bien (maison, appartement, villa, studio, terrain), " +
      "style architectural, état apparent, nombre estimé de chambres et de salles de bain visibles, " +
      "couleurs dominantes, matériaux, environnement (urbain, rural, jardin, piscine, garage), " +
      "éclairage, et toute particularité notable. Sois descriptif et précis."
    );

    // 2. Extraction des caractéristiques structurées via vision IA
    const features = await MistralService.extractPropertyFeatures(images);

    // 3. Construction des critères de recherche depuis les features extraites
    const searchCriteria = {};
    if (features.property_type && features.property_type !== 'null') {
      searchCriteria.type = features.property_type;
    }
    if (features.estimated_bedrooms != null && features.estimated_bedrooms > 0) {
      // Cherche des biens avec au moins ce nombre de chambres - 1 (pour élargir)
      searchCriteria.bedroomsMin = Math.max(1, features.estimated_bedrooms - 1);
    }
    if (features.estimated_bathrooms != null && features.estimated_bathrooms > 0) {
      searchCriteria.bathroomsMin = Math.max(1, features.estimated_bathrooms - 1);
    }

    // 4. Recherche en base de données
    const results = await AdService.search(searchCriteria);

    // 5. Enregistre l'interaction si l'utilisateur est connecté
    if (userId && results.length > 0) {
      for (const r of results.slice(0, 5)) {
        await InteractionModel.recordView({ userId, adId: r.ad_id });
      }
    }

    // 6. Réponse conversationnelle : description de l'image + propositions
    const userContext = `L'utilisateur a envoyé une image d'un bien immobilier.

DESCRIPTION DE L'IMAGE PAR L'IA :
${imageDescription}

CARACTÉRISTIQUES EXTRAITES :
- Type détecté : ${features.property_type || 'non déterminé'}
- Chambres estimées : ${features.estimated_bedrooms || '?'}
- Douches/SDB estimées : ${features.estimated_bathrooms || '?'}
- État : ${features.condition || 'non déterminé'}
- Style : ${features.style || 'non déterminé'}
- Piscine : ${features.has_pool ? 'oui' : 'non'}
- Jardin : ${features.has_garden ? 'oui' : 'non'}
- Garage : ${features.has_garage ? 'oui' : 'non'}
- Balcon : ${features.has_balcony ? 'oui' : 'non'}
- Terrasse : ${features.has_terrace ? 'oui' : 'non'}`;

    const response = await MistralService.buildImageSearchResponse(
      imageDescription,
      features,
      results,
      searchCriteria
    );

    return {
      features,
      imageDescription,
      results,
      response,
      count: results.length,
    };
  },
};

export default AgentAIService;
