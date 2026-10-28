import axios from 'axios';
import http from 'http';
import https from 'https';
import { config } from '../config/index.js';
import { PREFERENCE_CATALOG, sanitizePreferenceCodes } from '../constants/preferences.js';
import { createTtlCache } from '../utils/ttlCache.js';
import { heuristicParse } from '../utils/queryHeuristics.js';

/**
 * Client HTTP partagé : la réutilisation des sockets TCP (keep-alive) évite
 * un handshake TLS à chaque appel Mistral (~100-200 ms gagnés par requête).
 */
const httpClient = axios.create({
  timeout: 15000,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 32 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 32 }),
});

/**
 * Cache des analyses de requête (5 min). Une même question posée deux fois
 * (par le même utilisateur ou un autre) ne rappelle pas Mistral.
 */
const parseCache = createTtlCache({ ttlMs: 5 * 60 * 1000, maxSize: 500 });

const PREFERENCE_LABELS = PREFERENCE_CATALOG.map((p) => `- "${p.code}" : ${p.label}`).join('\n');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Modèles de repli, utilisés UNIQUEMENT si le modèle principal est saturé
 * (429, ex: code 3505 "backend_out_of_capacity") ou retiré du catalogue (404).
 * La clé API reste TOUJOURS la clé principale — aucune rotation de clé.
 * Surchargables via .env : MISTRAL_MODEL_FALLBACKS / MISTRAL_VISION_FALLBACKS.
 */
const TEXT_MODEL_FALLBACKS = (process.env.MISTRAL_MODEL_FALLBACKS || 'mistral-small-latest,ministral-8b-latest')
  .split(',').map((s) => s.trim()).filter(Boolean);
const VISION_MODEL_FALLBACKS = (process.env.MISTRAL_VISION_FALLBACKS || 'mistral-medium-latest,magistral-small-latest')
  .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Service Mistral AI — Agent virtuel immobilier.
 *
 * Rôle : convertir un prompt en langage naturel (ex: "cherche moi une maison
 * proche du lycée de Ngoa-Ekellé, 3 chambres, moins de 50 millions") en un
 * objet JSON structuré consommable par le moteur de recherche du backend.
 */
export const MistralService = {
  /**
   * Convertit un message utilisateur en critères de recherche JSON.
   *
   * Stratégie en 3 temps (performance) :
   *  1. cache mémoire → réponse instantanée si la question a déjà été posée ;
   *  2. appel Mistral en mode JSON (fiable, pas de regex sur du texte libre) ;
   *  3. repli heuristique local si Mistral échoue/est indisponible.
   *
   * @param {string} userMessage - Le prompt en langage naturel.
   * @returns {Promise<Object>} Critères structurés.
   */
  async parseSearchQuery(userMessage) {
    const cacheKey = (userMessage || '').trim().toLowerCase();
    if (!cacheKey) {
      const err = new Error('Message vide');
      err.status = 400;
      throw err;
    }

    return parseCache.wrap(cacheKey, () => this._parseSearchQueryUncached(userMessage));
  },

  async _parseSearchQueryUncached(userMessage) {
    const systemPrompt = `Tu es un assistant immobilier spécialisé dans le marché camerounais.
Ton rôle est de convertir la demande de l'utilisateur en un objet JSON strictement structuré
que le backend pourra consommer pour effectuer une recherche en base de données.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte additionnel, sans markdown.

Format attendu :
{
  "intent": "search" | "small_talk",
  "type": "maison" | "appartement" | "studio" | "chambre" | "villa" | "terrain" | "bureau" | null,
  "city": "nom de la ville" | null,
  "district": "nom du quartier" | null,
  "near": "lieu repère à géocoder (ex: ngoa ekele, bastos)" | null,
  "preferences": ["code1", "code2"],
  "bedroomsMin": nombre | null,
  "bathroomsMin": nombre | null,
  "priceMin": nombre | null,
  "priceMax": nombre | null,
  "sortBy": "price_asc" | "price_desc" | "recent" | null,
  "radiusKm": nombre | null,
  "explanation": "courte reformulation en français de ce que tu as compris"
}

CODES DE PRÉFÉRENCES AUTORISÉS (n'utilise QUE ceux-ci) :
${PREFERENCE_LABELS}

Règles :
- "proche de X" / "près de X" / "pas loin de X" où X est un équipement (lycée, hôpital,
  marché, école, transport...) => ajoute le code de préférence correspondant dans
  "preferences", ET si X contient aussi un lieu géographique ("le lycée de Ngoa-Ekellé",
  "le lycée d'Ekounou"), renseigne ce lieu dans "district" (ou "city" si c'est une
  ville), mets le repère complet dans "near" (ex: "lycée Ekounou Yaoundé") ET
  radiusKm = 3 pour une recherche géolocalisée autour du repère.
- "proche de X" où X est uniquement un lieu (quartier/ville) => "near" = X, radiusKm = 5.
  Renseigne aussi "district" ou "city" si X est un quartier/ville connu.
- Si plusieurs équipements sont cités, mets plusieurs codes dans "preferences".
- "moins chère" / "pas cher" => sortBy = "price_asc".
- Les montants en "millions" doivent être convertis en FCFA (ex: "50 millions" => 50000000).
- Si l'utilisateur ne précise pas un champ, mets null (ou [] pour "preferences").
- Les nombres doivent être des entiers, pas des chaînes.
- "explanation" doit être une phrase courte et naturelle en français.
- Si le message n'est PAS une demande de recherche de biens (salutation "bonjour"
  ou "comment allez-vous", remerciement, question sur l'assistant, message
  incohérent du type "dddddd"), renvoie "intent": "small_talk" et mets TOUS les
  autres champs à null (ou [] pour "preferences"). N'invente JAMAIS de critères
  dans ce cas : pas de ville, pas de type, pas de prix par défaut.
- Ne renvoie aucun texte hors du JSON.`;

    const payload = {
      model: config.mistral.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 400,
      // Mode JSON natif de Mistral : évite le parsing fragile de texte libre
      response_format: { type: 'json_object' },
    };

    try {
      const res = await this._callMistralResilient(payload, {
        timeout: 15000,
        fallbackModels: [TEXT_MODEL_FALLBACKS[0]], // repli conservateur : le mode JSON exige un modèle compatible
      });

      const raw = res.data.choices[0].message.content.trim();
      // Extraction robuste du JSON (au cas où Mistral ajoute du texte)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Réponse Mistral sans JSON exploitable');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      const criteria = this.normalizeCriteria(parsed);
      // Si l'IA n'a rien trouvé d'exploitable, on complète avec l'heuristique
      if (criteria.preferences.length === 0) {
        const { criteria: h } = heuristicParse(userMessage);
        if (h.preferences.length > 0) criteria.preferences = h.preferences;
      }
      return criteria;
    } catch (err) {
      console.error('[Mistral] Erreur parseSearchQuery:', err.message);
      if (err.response) {
        console.error('[Mistral] Statut:', err.response.status, 'Data:', JSON.stringify(err.response.data));
      }

      // Repli : analyse locale par mots-clés (aucun appel réseau)
      const { criteria, signals } = heuristicParse(userMessage);
      if (signals > 0) {
        console.warn('[Mistral] Repli heuristique utilisé (IA indisponible).');
        return this.normalizeCriteria({ ...criteria, explanation: 'Analyse locale (IA indisponible).' });
      }
      // Rien reconnu ET IA indisponible : ce n'est probablement pas une
      // demande de recherche → réponse conversationnelle, SANS erreur.
      return this.normalizeCriteria({
        intent: 'small_talk',
        explanation: 'Message hors recherche (IA indisponible).',
      });
    }
  },

  /**
   * Réponse conversationnelle à un message HORS recherche (salutation,
   * remerciement, charabia). Aucune liste de biens n'est renvoyée.
   */
  async buildSmallTalkResponse(userMessage) {
    const systemPrompt = `Tu es l'assistant virtuel de NestFind, une plateforme immobilière camerounaise.
L'utilisateur vient de t'écrire un message qui N'EST PAS une demande de recherche de biens.
Réponds naturellement et brièvement (1 à 3 phrases maximum), en français, puis ramène
poliment la conversation vers ton expertise : aider à trouver un logement (quartier,
type de bien, budget, équipements de proximité). N'invente AUCUN résultat de recherche
et ne cite AUCUN bien, prix ni quartier comme s'ils venaient d'une recherche.`;

    try {
      const res = await this._callMistralResilient({
        model: config.mistral.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.6,
        max_tokens: 150,
      }, { timeout: 15000, fallbackModels: TEXT_MODEL_FALLBACKS });
      return res.data.choices[0].message.content.trim();
    } catch (err) {
      console.error('[Mistral] Erreur buildSmallTalkResponse:', err.message);
      // Repli local (IA indisponible) : réponse type déterminée par mots-clés
      const msg = (userMessage || '').toLowerCase();
      if (/bonjour|salut|bonsoir|hello|coucou|bjr|slt\b|cc\b/.test(msg)) {
        return "Bonjour ! Je suis votre assistant NestFind. Comment puis-je vous aider à trouver un bien ? " +
          "Décrivez simplement votre besoin, par exemple « studio proche du marché à Ekounou ».";
      }
      if (/merci/.test(msg)) {
        return "Avec plaisir ! Si vous voulez affiner votre recherche ou comparer des biens, n'hésitez pas.";
      }
      return "Je suis l'assistant immobilier NestFind : je vous aide à trouver un logement en langage naturel. " +
        "Dites-moi par exemple « une maison de 3 chambres à Ngoa-Ekellé, moins de 50 millions » et je cherche pour vous.";
    }
  },

  /**
   * Normalise les critères reçus de Mistral vers le format attendu par PropertyModel.search.
   */
  normalizeCriteria(raw = {}) {
    return {
      // "small_talk" : message hors recherche (salutation, bavardage,
      // charabia) — l'orchestrateur ne lancera PAS de recherche de biens.
      intent: raw.intent === 'small_talk' ? 'small_talk' : 'search',
      type: raw.type || null,
      city: raw.city || null,
      district: raw.district || null,
      near: raw.near || null,
      // On ne garde que des codes du catalogue (sécurité + cohérence SQL)
      preferences: sanitizePreferenceCodes(raw.preferences),
      bedroomsMin: this.toInt(raw.bedroomsMin),
      bathroomsMin: this.toInt(raw.bathroomsMin),
      priceMin: this.toInt(raw.priceMin),
      priceMax: this.toInt(raw.priceMax),
      sortBy: raw.sortBy || null,
      radiusKm: this.toInt(raw.radiusKm),
      explanation: typeof raw.explanation === 'string' ? raw.explanation : null,
    };
  },

  toInt(v) {
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  },

  /** Statistiques du cache (diagnostic / monitoring). */
  parseCacheStats() {
    return { size: parseCache.size };
  },

  /**
   * Appel Mistral résilient (anti-429).
   *
   * Le modèle principal (config.mistral.model / visionModel) est toujours
   * essayé EN PREMIER, avec la clé API principale. En cas de saturation
   * (429 — ex: code 3505 backend_out_of_capacity), on attend puis on
   * réessaie le MÊME modèle ; si la saturation persiste, on bascule sur
   * les modèles de repli déclarés. Une erreur 401/403 (clé invalide)
   * remonte immédiatement — on ne change jamais de clé.
   *
   * @param {Object} payload - Corps de la requête (model, messages, ...).
   * @param {Object} opts - { timeout, fallbackModels }.
   */
  async _callMistralResilient(payload, { timeout = 15000, fallbackModels = [] } = {}) {
    const models = [payload.model, ...fallbackModels];
    const retryDelays = [1500, 3000]; // anti-429 : 2 réessais sur le modèle principal
    let lastErr = null;

    for (let m = 0; m < models.length; m++) {
      const model = models[m];
      // Modèle principal : 1 essai + 2 réessais. Modèles de repli : 1 essai chacun.
      const attempts = m === 0 ? 1 + retryDelays.length : 1;
      for (let a = 0; a < attempts; a++) {
        if (a > 0) {
          console.warn(`[Mistral] 429 -> réessai ${a}/${retryDelays.length} sur ${model} dans ${retryDelays[a - 1]} ms`);
          await sleep(retryDelays[a - 1]);
        }
        try {
          const res = await httpClient.post(config.mistral.apiUrl, { ...payload, model }, {
            headers: {
              'Authorization': `Bearer ${config.mistral.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout,
          });
          if (m > 0) {
            console.warn(`[Mistral] Bascule modèle réussie : ${models[0]} -> ${model}`);
          }
          return res;
        } catch (err) {
          lastErr = err;
          const status = err.response && err.response.status;
          if (status === 401 || status === 403) throw err;  // clé invalide : inutile d'insister
          if (status === 429) continue;                     // saturé : réessayer, puis modèle suivant
          if (status === 404 || status === 400) break;      // modèle retiré/incompatible : modèle suivant
          if (status >= 500 || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') continue;
          throw err;                                        // autre erreur (4xx logique) : remonter
        }
      }
    }
    throw lastErr;
  },

  /**
   * Génère une description d'annonce à partir des caractéristiques.
   */
  async generateAdDescription({ type, area, bedrooms, bathrooms, city, district, price }) {
    const systemPrompt = `Tu es un rédacteur immobilier professionnel. Rédige une description d'annonce
attrayante en français, de 3 à 5 phrases, à partir des caractéristiques fournies.
Ne mentionne pas le prix dans la description. Réponds uniquement avec le texte de la description.`;

    const userContent = `Type: ${type}, Surface: ${area} m², Chambres: ${bedrooms}, Douches/SDB: ${bathrooms},
Ville: ${city}, Quartier: ${district}, Prix: ${price} FCFA`;

    try {
      const res = await this._callMistralResilient({
        model: config.mistral.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.7,
        max_tokens: 400,
      }, { timeout: 15000, fallbackModels: TEXT_MODEL_FALLBACKS });
      return res.data.choices[0].message.content.trim();
    } catch (err) {
      console.error('[Mistral] Erreur generateAdDescription:', err.message);
      throw new Error('Impossible de générer la description');
    }
  },

  /**
   * Analyse une image (ou plusieurs) avec le modèle de vision Pixtral.
   * @param {string|Array<string>} images - URL(s) ou data URI(s) base64.
   * @param {string} [prompt] - Question/instruction en langage naturel.
   * @returns {Promise<string>} Description textuelle renvoyée par l'IA.
   */
  async analyzeImage(images, prompt) {
    const imageList = Array.isArray(images) ? images : [images];
    if (imageList.length === 0) {
      const err = new Error('Aucune image fournie');
      err.status = 400;
      throw err;
    }

    const userContent = [
      { type: 'text', text: prompt || "Décris cette image immobilière en détail : type de bien, état, pièces visibles, style architectural, couleurs, environnement." },
      ...imageList.map((url) => ({ type: 'image_url', image_url: url })),
    ];

    try {
      const res = await this._callMistralResilient({
        model: config.mistral.visionModel,
        messages: [{ role: 'user', content: userContent }],
        temperature: 0.3,
        max_tokens: 800,
      }, { timeout: 45000, fallbackModels: VISION_MODEL_FALLBACKS });
      return res.data.choices[0].message.content.trim();
    } catch (err) {
      console.error('[Mistral] Erreur analyzeImage:', err.message);
      if (err.response) {
        console.error('[Mistral] Statut:', err.response.status, 'Data:', JSON.stringify(err.response.data));
      }
      throw new Error("Impossible d'analyser l'image avec l'IA");
    }
  },

  /**
   * Analyse une image et renvoie un objet JSON structuré (type, chambres, état...).
   * @param {string|Array<string>} images - URL(s) ou data URI(s) base64.
   * @returns {Promise<Object>} Caractéristiques extraites.
   */
  async extractPropertyFeatures(images) {
    const imageList = Array.isArray(images) ? images : [images];
    const systemPrompt = `Tu es un expert immobilier. Analyse cette image et renvoie UNIQUEMENT un objet JSON valide avec ce format :
{
  "property_type": "maison" | "appartement" | "studio" | "villa" | "terrain" | null,
  "estimated_bedrooms": nombre | null,
  "estimated_bathrooms": nombre | null,
  "condition": "neuf" | "bon" | "à rénover" | null,
  "style": "moderne" | "traditionnel" | "contemporain" | "tropical" | null,
  "has_pool": true | false,
  "has_garden": true | false,
  "has_garage": true | false,
  "has_balcony": true | false,
  "has_terrace": true | false,
  "description": "description courte en français"
}
Ne renvoie aucun texte hors du JSON.`;

    const userContent = [
      { type: 'text', text: systemPrompt },
      ...imageList.map((url) => ({ type: 'image_url', image_url: url })),
    ];

    try {
      const res = await this._callMistralResilient({
        model: config.mistral.visionModel,
        messages: [{ role: 'user', content: userContent }],
        temperature: 0.1,
        max_tokens: 600,
      }, { timeout: 45000, fallbackModels: VISION_MODEL_FALLBACKS });
      const raw = res.data.choices[0].message.content.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Réponse vision sans JSON exploitable');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('[Mistral] Erreur extractPropertyFeatures:', err.message);
      if (err.response) {
        console.error('[Mistral] Statut:', err.response.status, JSON.stringify(err.response.data));
      }
      throw new Error("Impossible d'extraire les caractéristiques du bien");
    }
  },

  /**
   * Réponse conversationnelle de l'agent IA après une recherche par image.
   * Décrit d'abord ce que l'IA voit dans l'image, puis présente les biens trouvés.
   */
  async buildImageSearchResponse(imageDescription, features, results, criteria) {
    const systemPrompt = `Tu es un agent immobilier virtuel au Cameroun. L'utilisateur t'a envoyé une image d'un bien immobilier.
Tu as reçu :
1. Une description détaillée de ce que l'IA voit dans l'image.
2. Les caractéristiques extraites de l'image.
3. Les résultats RÉELS de la recherche en base de données.

STRUCTURE OBLIGATOIRE DE TA RÉPONSE :
1. Commence par décrire ce que tu vois dans l'image en te basant sur la description fournie. Sois descriptif et naturel, comme si tu regardais l'image avec l'utilisateur. Mentionne le type de bien, le style, l'état, les pièces visibles, l'environnement, etc.
2. Ensuite, fais une transition naturelle vers les propositions (ex: "D'après ce que je vois, voici les biens similaires disponibles :").
3. Présente UNIQUEMENT les biens réellement trouvés dans les résultats, avec leurs informations exactes (titre, prix, ville, quartier, chambres).

RÈGLES CRITIQUES :
- Ne JAMAIS inventer ou lister des biens qui ne figurent pas dans les résultats fournis.
- Si AUCUN bien n'a été trouvé, dis-le clairement après la description et propose d'élargir la recherche.
- Sois concis, amical et honnête.
- La description de l'image doit faire 3 à 5 phrases.`;

    const resultsSummary = results.length === 0
      ? 'Aucun bien ne correspond aux critères extraits de l\'image.'
      : results.slice(0, 8).map(r =>
          `- ${r.title} | ${r.price} FCFA | ${r.city}, ${r.district || 'quartier non précisé'} | ${r.bedrooms || 0} chambres`
        ).join('\n');

    const userContent = `Description de l'image par l'IA :
${imageDescription}

Caractéristiques extraites :
- Type : ${features.property_type || 'non déterminé'}
- Chambres estimées : ${features.estimated_bedrooms || '?'}
- Douches/SDB : ${features.estimated_bathrooms || '?'}
- État : ${features.condition || 'non déterminé'}
- Style : ${features.style || 'non déterminé'}

Résultats de recherche (${results.length} au total) :
${resultsSummary}`;

    try {
      const res = await this._callMistralResilient({
        model: config.mistral.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.5,
        max_tokens: 1000,
      }, { timeout: 20000, fallbackModels: TEXT_MODEL_FALLBACKS });
      return res.data.choices[0].message.content.trim();
    } catch (err) {
      console.error('[Mistral] Erreur buildImageSearchResponse:', err.message);
      // Fallback: description + résultats simples
      let fallback = `Voici ce que je vois dans votre image :\n${imageDescription}\n\n`;
      if (results.length === 0) {
        fallback += `Je n'ai trouvé aucun bien correspondant à cette image dans notre base. Essayez avec d'autres critères.`;
      } else {
        fallback += `Voici les biens similaires disponibles :\n${resultsSummary}`;
      }
      return fallback;
    }
  },

  /**
   * Réponse conversationnelle de l'agent IA après une recherche.
   */
  async buildSearchResponse(userMessage, results, criteria) {
    const systemPrompt = `Tu es un agent immobilier virtuel au Cameroun. L'utilisateur t'a demandé de chercher un bien.
Tu as reçu les résultats RÉELS de la recherche en base de données.

RÈGLES CRITIQUES :
- Réponds en TEXTE BRUT uniquement : aucun markdown (pas de **, ##, -, *, \` ni tableaux).
- N'énumère PAS les biens un par un : ils sont déjà affichés dans un tableau à côté de ta réponse.
- Résume en 1-3 phrases : combien de biens trouvés, dans quel quartier/ville, et la fourchette de prix (ex: "de 42 000 à 569 000 FCFA").
- Si une proximité précise apparaît dans les résultats (ex: "Lycée d'Ekounou", "Marché de Mokolo"), cite-la telle quelle.
- Si AUCUN bien n'a été trouvé, dis clairement "Je n'ai trouvé aucun bien correspondant à vos critères." puis propose d'élargir la recherche.
- Ne JAMAIS inventer ou lister des biens qui ne figurent pas dans les résultats fournis.
- Sois concis, amical et honnête.`;

    const resultsSummary = results.length === 0
      ? 'Aucun bien ne correspond aux critères.'
      : results.slice(0, 8).map(r => {
          const prefs = Array.isArray(r.preferences) && r.preferences.length > 0
            ? ` | proximité: ${r.preferences.map((p) => p.note || p.label || p.code).join(', ')}`
            : '';
          return `- ${r.title} | ${r.price} FCFA | ${r.city}, ${r.district || 'quartier non précisé'} | ${r.bedrooms || 0} chambres${prefs}`;
        }).join('\n');

    const userContent = `Demande utilisateur: "${userMessage}"
Critères extraits: ${JSON.stringify(criteria)}
${criteria._relaxed ? `NOTE: la recherche a été ÉLARGIE car aucun bien ne correspondait strictement. Critères relâchés: ${criteria._relaxed}. Dis-le poliment à l'utilisateur.` : ''}
Résultats (${results.length} au total):
${resultsSummary}`;

    try {
      const res = await this._callMistralResilient({
        model: config.mistral.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.5,
        max_tokens: 800,
      }, { timeout: 15000, fallbackModels: TEXT_MODEL_FALLBACKS });
      return res.data.choices[0].message.content.trim();
    } catch (err) {
      console.error('[Mistral] Erreur buildSearchResponse:', err.message);
      // Fallback: réponse simple sans IA
      if (results.length === 0) {
        return `Je n'ai trouvé aucun bien correspondant à votre recherche. Essayez d'élargir vos critères (zone, budget, nombre de chambres).`;
      }
      return `J'ai trouvé ${results.length} bien(s) correspondant à votre recherche :\n${resultsSummary}`;
    }
  },
};

export default MistralService;
