function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
}

function isAuthorMatch(inputAuthor, candidateAuthor) {
  const inputTokens = normalizeName(inputAuthor);
  const candidateTokens = normalizeName(candidateAuthor);

  const common = inputTokens.filter(t =>
    candidateTokens.some(c => c.startsWith(t) || t.startsWith(c))
  );

  return common.length > 0;
}

module.exports = {
  normalizeName,
  isAuthorMatch
};
