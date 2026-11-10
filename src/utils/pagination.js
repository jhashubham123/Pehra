function pageResult(items, total, { page, limit }) {
  return { items, page, limit, total: Number(total) };
}

function offset({ page, limit }) {
  return (page - 1) * limit;
}

module.exports = { pageResult, offset };
