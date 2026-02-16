function generateCSVString(rows) {
  return rows.map(row =>
    row.map(cell => {
      const str = String(cell ?? "").replace(/"/g, '""');
      return (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r"))
        ? `"${str}"` : str;
    }).join(",")
  ).join("\r\n");
}
