(() => {
  const cards = Array.from(document.querySelectorAll('.article-card'));
  const buttons = Array.from(document.querySelectorAll('[data-filter]'));
  const search = document.getElementById('article-search');
  const status = document.getElementById('results-status');
  const empty = document.getElementById('empty-state');
  let category = 'all';

  function update() {
    if (!cards.length || !search || !status || !empty) return;
    const query = (search.value || '').trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const matchesCategory = category === 'all' || card.dataset.category === category;
      const haystack = `${card.dataset.search || ''} ${card.innerText || ''}`.toLowerCase();
      const show = matchesCategory && (!query || haystack.includes(query));
      card.hidden = !show;
      if (show) visible += 1;
    });
    empty.hidden = visible !== 0;
    status.textContent = `${visible} ${visible === 1 ? 'field note' : 'practical field notes'}`;
  }

  buttons.forEach((button) => button.addEventListener('click', () => {
    category = button.dataset.filter || 'all';
    buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    update();
  }));

  if (search) search.addEventListener('input', update);
  document.querySelectorAll('#year').forEach((year) => {
    year.textContent = new Date().getFullYear();
  });
})();
