// Implements the Elo engine for player and player-deck leaderboards. The code
// rates only clean, resolved matches and can reset ratings per calendar year or
// run one continuous all-time ladder.
const DEFAULT_STARTING_RATING = 1500;
const DEFAULT_K_FACTOR = 16;
const DEFAULT_RESET_BY_YEAR = true;
const DEFAULT_ENTITY_MODE = 'player';

const RESULT_SCORES = Object.freeze({
  win: 1,
  loss: 0,
  draw: 0.5
});

function getFiniteNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeOptions(options = {}) {
  return {
    startingRating: getFiniteNumber(options.startingRating, DEFAULT_STARTING_RATING),
    kFactor: getFiniteNumber(options.kFactor, DEFAULT_K_FACTOR),
    resetByYear: options.resetByYear !== false,
    entityMode: normalizeEntityMode(options.entityMode)
  };
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeEntityMode(value) {
  return String(value || DEFAULT_ENTITY_MODE).trim().toLowerCase() === 'player_deck'
    ? 'player_deck'
    : DEFAULT_ENTITY_MODE;
}

function isPlayerDeckMode(entityMode = DEFAULT_ENTITY_MODE) {
  return normalizeEntityMode(entityMode) === 'player_deck';
}

function getMatchDate(match) {
  return normalizeText(match?.date || match?.Date);
}

function getPlayerAKey(match) {
  return normalizeText(match?.player_a_key || match?.player_key);
}

function getPlayerAName(match) {
  return normalizeText(match?.player_a || match?.player);
}

function getPlayerBKey(match) {
  return normalizeText(match?.player_b_key || match?.opponent_key);
}

function getPlayerBName(match) {
  return normalizeText(match?.player_b || match?.opponent);
}

function getDeckAName(match) {
  return normalizeText(match?.deck_a || match?.deck);
}

function getDeckBName(match) {
  return normalizeText(match?.deck_b || match?.opponent_deck);
}

function getEntityDetails(match, side = 'a', entityMode = DEFAULT_ENTITY_MODE) {
  const normalizedSide = side === 'b' ? 'b' : 'a';
  const basePlayerKey = normalizedSide === 'a' ? getPlayerAKey(match) : getPlayerBKey(match);
  const basePlayerName = normalizedSide === 'a' ? getPlayerAName(match) : getPlayerBName(match);
  const deck = normalizedSide === 'a' ? getDeckAName(match) : getDeckBName(match);

  if (isPlayerDeckMode(entityMode)) {
    // Deck-scoped Elo treats "player on deck" as a separate ladder identity from
    // the same player on a different deck, but names should remain player-only.
    const entityKey = basePlayerKey && deck ? `${basePlayerKey}:::${deck}` : '';
    const displayName = basePlayerName || basePlayerKey;

    return {
      entityKey,
      displayName,
      basePlayerKey,
      basePlayerName,
      deck
    };
  }

  return {
    entityKey: basePlayerKey,
    displayName: basePlayerName || basePlayerKey,
    basePlayerKey,
    basePlayerName,
    deck
  };
}

function getCalendarYear(dateString = '') {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString.slice(0, 4);
  }

  const parsedDate = new Date(dateString);
  return Number.isFinite(parsedDate.getTime()) ? String(parsedDate.getUTCFullYear()) : '';
}

function getSeasonKey(match, resetByYear) {
  if (!resetByYear) {
    return 'all-time';
  }

  return getCalendarYear(getMatchDate(match)) || 'unknown-year';
}

function getRoundValue(match) {
  const roundValue = Number(match?.round);
  return Number.isFinite(roundValue) ? roundValue : Number.POSITIVE_INFINITY;
}

function getSortValue(match, propertyNames = []) {
  for (const propertyName of propertyNames) {
    const value = normalizeText(match?.[propertyName]);
    if (value) {
      return value;
    }
  }

  return '';
}

function compareMatches(a, b) {
  return (
    getMatchDate(a.match).localeCompare(getMatchDate(b.match)) ||
    getSortValue(a.match, ['event_id', 'eventId', 'event']).localeCompare(getSortValue(b.match, ['event_id', 'eventId', 'event'])) ||
    getRoundValue(a.match) - getRoundValue(b.match) ||
    getSortValue(a.match, ['pair_key', 'pairKey']).localeCompare(getSortValue(b.match, ['pair_key', 'pairKey'])) ||
    a.index - b.index
  );
}

function getResultScore(match) {
  // Generated data evolved over time, so result information may live in newer
  // outcome fields, generic result_type fields, or legacy game counters.
  const outcome = normalizeText(match?.outcome).toLowerCase();
  if (outcome === 'player_a_win') {
    return 1;
  }
  if (outcome === 'player_b_win') {
    return 0;
  }
  if (outcome === 'draw') {
    return 0.5;
  }

  const resultType = normalizeText(match?.result_type).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(RESULT_SCORES, resultType)) {
    return RESULT_SCORES[resultType];
  }

  const gamesA = Number(match?.games_a);
  const gamesB = Number(match?.games_b);
  if (Number.isFinite(gamesA) && Number.isFinite(gamesB)) {
    if (gamesA > gamesB) {
      return 1;
    }
    if (gamesA < gamesB) {
      return 0;
    }
    return 0.5;
  }

  const gamesWon = Number(match?.games_won);
  const gamesLost = Number(match?.games_lost);
  if (Number.isFinite(gamesWon) && Number.isFinite(gamesLost)) {
    if (gamesWon > gamesLost) {
      return 1;
    }
    if (gamesWon < gamesLost) {
      return 0;
    }
    return 0.5;
  }

  return null;
}

function isRatedMatch(match, entityMode = DEFAULT_ENTITY_MODE) {
  const playerDetails = getEntityDetails(match, 'a', entityMode);
  const opponentDetails = getEntityDetails(match, 'b', entityMode);
  const resultType = normalizeText(match?.result_type).toLowerCase();
  const outcome = normalizeText(match?.outcome).toLowerCase();
  const pairingQuality = normalizeText(match?.pairing_quality).toLowerCase();

  if (!playerDetails.entityKey || !opponentDetails.entityKey || playerDetails.entityKey === opponentDetails.entityKey) {
    // Missing identities, self-pairings, byes, unknowns, and conflict-marked
    // rows would distort the ladder, so they are excluded before batching.
    return false;
  }

  if (match?.is_bye || resultType === 'bye' || resultType === 'unknown' || outcome === 'unknown') {
    return false;
  }

  if (pairingQuality === 'conflict') {
    return false;
  }

  if (isPlayerDeckMode(entityMode) && (!playerDetails.deck || !opponentDetails.deck)) {
    return false;
  }

  return getResultScore(match) !== null;
}

function getResultTypeFromScore(score) {
  if (score === 1) {
    return 'win';
  }
  if (score === 0) {
    return 'loss';
  }
  if (score === 0.5) {
    return 'draw';
  }

  return 'unknown';
}

function ensureSeasonState(
  seasonStates,
  seasonKey,
  seasonYear,
  playerDetails,
  startingRating
) {
  const stateKey = `${seasonKey}:::${playerDetails.entityKey}`;
  const normalizedDisplayName = normalizeText(playerDetails.displayName);
  const normalizedBasePlayerKey = normalizeText(playerDetails.basePlayerKey);
  const normalizedBasePlayerName = normalizeText(playerDetails.basePlayerName);
  const normalizedDeck = normalizeText(playerDetails.deck);

  if (!seasonStates.has(stateKey)) {
    seasonStates.set(stateKey, {
      seasonKey,
      seasonYear,
      playerKey: playerDetails.entityKey,
      displayName: normalizedDisplayName || playerDetails.entityKey,
      basePlayerKey: normalizedBasePlayerKey,
      basePlayerName: normalizedBasePlayerName || normalizedDisplayName || playerDetails.entityKey,
      deck: normalizedDeck,
      rating: startingRating,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      lastActiveDate: '',
      lastEventId: '',
      lastEvent: '',
      lastRound: null
    });
  }

  const state = seasonStates.get(stateKey);
  if (normalizedDisplayName) {
    state.displayName = normalizedDisplayName;
  }
  if (normalizedBasePlayerKey) {
    state.basePlayerKey = normalizedBasePlayerKey;
  }
  if (normalizedBasePlayerName) {
    state.basePlayerName = normalizedBasePlayerName;
  }
  if (normalizedDeck) {
    state.deck = normalizedDeck;
  }

  return state;
}

function pushHistoryEntry(historyByPlayer, playerKey, entry) {
  if (!historyByPlayer.has(playerKey)) {
    historyByPlayer.set(playerKey, []);
  }

  historyByPlayer.get(playerKey).push(entry);
}

function updateSeasonState(state, {
  ratingAfter,
  score,
  matchDate,
  eventId,
  eventName,
  round
}) {
  state.rating = ratingAfter;
  state.matches += 1;

  if (score === 1) {
    state.wins += 1;
  } else if (score === 0) {
    state.losses += 1;
  } else {
    state.draws += 1;
  }

  state.lastActiveDate = matchDate;
  state.lastEventId = eventId;
  state.lastEvent = eventName;
  state.lastRound = Number.isFinite(round) ? round : null;
}

function buildBatchKey(match, seasonKey) {
  return [
    seasonKey,
    getMatchDate(match),
    getSortValue(match, ['event_id', 'eventId', 'event']),
    String(getRoundValue(match))
  ].join('|||');
}

function buildMatchBatches(matches = [], resetByYear = true, entityMode = DEFAULT_ENTITY_MODE) {
  // Matches in the same event round are batched so all rating deltas use the
  // ratings that existed before that round began.
  const sortedMatches = matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => isRatedMatch(match, entityMode))
    .sort(compareMatches)
    .map(({ match }) => ({
      match,
      seasonKey: getSeasonKey(match, resetByYear),
      seasonYear: resetByYear ? (getCalendarYear(getMatchDate(match)) || 'Unknown') : 'All-time'
    }));

  const batches = [];
  let currentBatch = null;

  sortedMatches.forEach(entry => {
    const batchKey = buildBatchKey(entry.match, entry.seasonKey);
    if (!currentBatch || currentBatch.batchKey !== batchKey) {
      currentBatch = {
        batchKey,
        seasonKey: entry.seasonKey,
        seasonYear: entry.seasonYear,
        matches: []
      };
      batches.push(currentBatch);
    }

    currentBatch.matches.push(entry.match);
  });

  return {
    batches,
    ratedMatchCount: sortedMatches.length
  };
}

// Calculates the rating delta for one side of an Elo-rated match.
export function calculateEloRatingDelta(ratingA, ratingB, scoreA, kFactor = DEFAULT_K_FACTOR) {
  const safeRatingA = getFiniteNumber(ratingA, DEFAULT_STARTING_RATING);
  const safeRatingB = getFiniteNumber(ratingB, DEFAULT_STARTING_RATING);
  const safeScoreA = getFiniteNumber(scoreA, 0);
  const safeKFactor = getFiniteNumber(kFactor, DEFAULT_K_FACTOR);
  const expectedScoreA = 1 / (1 + 10 ** ((safeRatingB - safeRatingA) / 400));

  // Positive deltas mean player A outperformed expectation; negative deltas mean
  // the result was worse than expected.
  return safeKFactor * (safeScoreA - expectedScoreA);
}

// Processes match records into season rows, per-player histories, and annotated
// match records with before/after ratings.
export function getPlayerEloHistory(matches = [], options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const { batches, ratedMatchCount } = buildMatchBatches(
    matches,
    normalizedOptions.resetByYear,
    normalizedOptions.entityMode
  );
  const seasonStates = new Map();
  const historyByPlayer = new Map();
  const processedMatches = [];

  batches.forEach(batch => {
    const pendingUpdates = batch.matches.map(match => {
      // Compute every match in the batch first, then apply updates. That avoids
      // order bias inside a single event round.
      const playerDetails = getEntityDetails(match, 'a', normalizedOptions.entityMode);
      const opponentDetails = getEntityDetails(match, 'b', normalizedOptions.entityMode);
      const playerState = ensureSeasonState(
        seasonStates,
        batch.seasonKey,
        batch.seasonYear,
        playerDetails,
        normalizedOptions.startingRating
      );
      const opponentState = ensureSeasonState(
        seasonStates,
        batch.seasonKey,
        batch.seasonYear,
        opponentDetails,
        normalizedOptions.startingRating
      );
      const playerRatingBefore = playerState.rating;
      const opponentRatingBefore = opponentState.rating;
      const playerScore = getResultScore(match);
      const delta = calculateEloRatingDelta(
        playerRatingBefore,
        opponentRatingBefore,
        playerScore,
        normalizedOptions.kFactor
      );

      return {
        match,
        batch,
        playerDetails,
        opponentDetails,
        playerState,
        opponentState,
        playerRatingBefore,
        opponentRatingBefore,
        playerScore,
        opponentScore: 1 - playerScore,
        playerRatingAfter: playerRatingBefore + delta,
        opponentRatingAfter: opponentRatingBefore - delta,
        playerDelta: delta
      };
    });

    pendingUpdates.forEach(update => {
      const matchDate = getMatchDate(update.match);
      const eventId = getSortValue(update.match, ['event_id', 'eventId']);
      const eventName = getSortValue(update.match, ['event', 'Event']);
      const roundValue = Number(update.match?.round);
      const playerResultType = getResultTypeFromScore(update.playerScore);
      const opponentResultType = getResultTypeFromScore(update.opponentScore);

      updateSeasonState(update.playerState, {
        ratingAfter: update.playerRatingAfter,
        score: update.playerScore,
        matchDate,
        eventId,
        eventName,
        round: roundValue
      });
      updateSeasonState(update.opponentState, {
        ratingAfter: update.opponentRatingAfter,
        score: update.opponentScore,
        matchDate,
        eventId,
        eventName,
        round: roundValue
      });

      pushHistoryEntry(historyByPlayer, update.playerState.playerKey, {
        seasonKey: update.batch.seasonKey,
        seasonYear: update.batch.seasonYear,
        date: matchDate,
        eventId,
        event: eventName,
        round: Number.isFinite(roundValue) ? roundValue : null,
        playerKey: update.playerState.playerKey,
        player: update.playerState.displayName,
        playerBaseKey: update.playerState.basePlayerKey,
        playerBaseName: update.playerState.basePlayerName,
        deck: update.playerDetails.deck,
        opponentKey: update.opponentState.playerKey,
        opponent: update.opponentState.displayName,
        opponentBaseKey: update.opponentState.basePlayerKey,
        opponentBaseName: update.opponentState.basePlayerName,
        opponentDeck: update.opponentDetails.deck,
        resultType: playerResultType,
        score: update.playerScore,
        ratingBefore: update.playerRatingBefore,
        ratingAfter: update.playerRatingAfter,
        delta: update.playerDelta
      });
      pushHistoryEntry(historyByPlayer, update.opponentState.playerKey, {
        seasonKey: update.batch.seasonKey,
        seasonYear: update.batch.seasonYear,
        date: matchDate,
        eventId,
        event: eventName,
        round: Number.isFinite(roundValue) ? roundValue : null,
        playerKey: update.opponentState.playerKey,
        player: update.opponentState.displayName,
        playerBaseKey: update.opponentState.basePlayerKey,
        playerBaseName: update.opponentState.basePlayerName,
        deck: update.opponentDetails.deck,
        opponentKey: update.playerState.playerKey,
        opponent: update.playerState.displayName,
        opponentBaseKey: update.playerState.basePlayerKey,
        opponentBaseName: update.playerState.basePlayerName,
        opponentDeck: update.playerDetails.deck,
        resultType: opponentResultType,
        score: update.opponentScore,
        ratingBefore: update.opponentRatingBefore,
        ratingAfter: update.opponentRatingAfter,
        delta: -update.playerDelta
      });

      processedMatches.push({
        ...update.match,
        seasonKey: update.batch.seasonKey,
        seasonYear: update.batch.seasonYear,
        entityMode: normalizedOptions.entityMode,
        playerEntityKey: update.playerState.playerKey,
        opponentEntityKey: update.opponentState.playerKey,
        playerBaseKey: update.playerState.basePlayerKey,
        playerBaseName: update.playerState.basePlayerName,
        opponentBaseKey: update.opponentState.basePlayerKey,
        opponentBaseName: update.opponentState.basePlayerName,
        playerDeck: update.playerDetails.deck,
        opponentDeck: update.opponentDetails.deck,
        playerRatingBefore: update.playerRatingBefore,
        playerRatingAfter: update.playerRatingAfter,
        opponentRatingBefore: update.opponentRatingBefore,
        opponentRatingAfter: update.opponentRatingAfter,
        playerDelta: update.playerDelta,
        opponentDelta: -update.playerDelta,
        playerScore: update.playerScore,
        opponentScore: update.opponentScore
      });
    });
  });

  const seasonRows = Array.from(seasonStates.values())
    .filter(state => state.matches > 0)
    .map(state => ({
      ...state,
      winRate: state.matches > 0 ? state.wins / state.matches : 0
    }));

  return {
    ...normalizedOptions,
    seasonRows,
    historyByPlayer,
    processedMatches,
    years: [...new Set(seasonRows.map(row => row.seasonYear).filter(Boolean))].sort(),
    ratedMatchCount,
    skippedMatchCount: Math.max(0, matches.length - ratedMatchCount)
  };
}

// Adds a season -> player -> rating lookup on top of getPlayerEloHistory().
export function buildYearlyEloRatings(matches = [], options = {}) {
  const eloHistory = getPlayerEloHistory(matches, options);
  const ratings = new Map();

  eloHistory.seasonRows.forEach(row => {
    if (!ratings.has(row.seasonKey)) {
      ratings.set(row.seasonKey, new Map());
    }

    ratings.get(row.seasonKey).set(row.playerKey, row.rating);
  });

  return {
    ...eloHistory,
    ratings
  };
}
