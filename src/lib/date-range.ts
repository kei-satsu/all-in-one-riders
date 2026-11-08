function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCurrentDateInterval(today: Date) {
  const startMonthOffset = today.getDate() >= 26 ? 0 : -1;
  const startDate = new Date(today.getFullYear(), today.getMonth() + startMonthOffset, 26);
  const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 25);

  return {
    fromDate: dateKey(startDate),
    toDate: dateKey(endDate),
  };
}
