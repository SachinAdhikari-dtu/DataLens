// ============================================================
// COMPLETE FIXED app.js - DataLens CSV Analysis Dashboard
// ============================================================

/* ---------- STATE ---------- */
const state = {
    datasets: [],
    currentDatasetIndex: -1,
    currentPage: 1,
    pageSize: 25,
    filters: {},
    globalSearch: '',
    sortColumn: null,
    sortDirection: 'asc',
    visibleColumns: new Set(),
    theme: 'dark',
    isUploading: false
};

/* ---------- DOM REFS ---------- */
const dom = {
    // Upload
    uploadSection: document.getElementById('uploadSection'),
    dashboardSection: document.getElementById('dashboardSection'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    browseBtn: document.getElementById('browseBtn'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    uploadProgress: document.getElementById('uploadProgress'),
    progressFill: document.querySelector('.progress-fill'),
    
    // Tabs
    datasetTabs: document.getElementById('datasetTabs'),
    
    // Dashboard
    statsRow: document.getElementById('statsRow'),
    qualityChips: document.getElementById('qualityChips'),
    recommendedCharts: document.getElementById('recommendedCharts'),
    insightsCards: document.getElementById('insightsCards'),
    
    // Table
    tableHead: document.getElementById('tableHead'),
    tableBody: document.getElementById('tableBody'),
    globalSearch: document.getElementById('globalSearch'),
    pageSize: document.getElementById('pageSize'),
    pageInfo: document.getElementById('pageInfo'),
    prevPage: document.getElementById('prevPage'),
    nextPage: document.getElementById('nextPage'),
    columnVisibilityPanel: document.getElementById('columnVisibilityPanel'),
    columnToggleBtn: document.getElementById('columnToggleBtn'),
    
    // Actions
    exportCsvBtn: document.getElementById('exportCsvBtn'),
    buildChartBtn: document.getElementById('buildChartBtn'),
    newDatasetBtn: document.getElementById('newDatasetBtn'),
    themeToggle: document.getElementById('themeToggle'),
    
    // Modal
    chartModal: document.getElementById('chartModal'),
    closeChartModal: document.getElementById('closeChartModal'),
    chartTypeSelect: document.getElementById('chartTypeSelect'),
    xAxisSelect: document.getElementById('xAxisSelect'),
    yAxisSelect: document.getElementById('yAxisSelect'),
    renderCustomChartBtn: document.getElementById('renderCustomChartBtn'),
    customChartContainer: document.getElementById('customChartContainer'),
    chartTooltip: document.getElementById('chartTooltip')
};

/* ---------- UTILITY FUNCTIONS ---------- */
function formatNumber(num) {
    if (num === undefined || num === null || isNaN(num)) return '—';
    if (Number.isInteger(num)) return num.toLocaleString();
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function debounce(fn, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };
    
    // Parse with simple CSV handling (supports quoted fields)
    const parseRow = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i+1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    };
    
    const headers = parseRow(lines[0]);
    const rows = lines.slice(1).map(line => {
        const values = parseRow(line);
        const row = {};
        headers.forEach((h, i) => {
            row[h] = values[i] || '';
        });
        return row;
    });
    
    return { headers, rows };
}

/* ---------- COMPUTE STATISTICS ---------- */
function computeStatistics(headers, rows) {
    const stats = {
        rowCount: rows.length,
        columnCount: headers.length,
        missingValues: 0,
        duplicateRows: 0,
        numericStats: {},
        categoricalStats: {}
    };
    
    // Count missing values
    rows.forEach(row => {
        headers.forEach(h => {
            if (row[h] === undefined || row[h] === null || String(row[h]).trim() === '') {
                stats.missingValues++;
            }
        });
    });
    
    // Detect duplicates
    const rowStrings = rows.map(row => headers.map(h => String(row[h] || '')).join('|'));
    const uniqueRows = new Set(rowStrings);
    stats.duplicateRows = rowStrings.length - uniqueRows.size;
    
    // Column type detection and numeric stats
    headers.forEach(h => {
        const values = rows.map(r => r[h]).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
        const numericValues = values.map(v => parseFloat(v)).filter(v => !isNaN(v));
        
        if (numericValues.length > 0) {
            const sorted = [...numericValues].sort((a, b) => a - b);
            const sum = numericValues.reduce((a, b) => a + b, 0);
            stats.numericStats[h] = {
                type: 'numeric',
                count: numericValues.length,
                min: sorted[0],
                max: sorted[sorted.length - 1],
                avg: sum / numericValues.length,
                sum: sum,
                median: sorted[Math.floor(sorted.length / 2)]
            };
        } else if (values.length > 0) {
            // Categorical
            const freq = {};
            values.forEach(v => {
                const key = String(v);
                freq[key] = (freq[key] || 0) + 1;
            });
            const sortedFreq = Object.entries(freq).sort((a, b) => b[1] - a[1]);
            stats.categoricalStats[h] = {
                type: 'categorical',
                count: values.length,
                unique: Object.keys(freq).length,
                top: sortedFreq[0] ? sortedFreq[0][0] : null,
                topCount: sortedFreq[0] ? sortedFreq[0][1] : 0
            };
        }
    });
    
    // Find primary numeric column
    const numericCols = Object.keys(stats.numericStats);
    if (numericCols.length > 0) {
        stats.primaryNumericColumn = numericCols[0];
    }
    
    return stats;
}

/* ---------- GENERATE CHARTS ---------- */
function generateCharts(headers, rows, stats) {
    const charts = [];
    const numericCols = Object.keys(stats.numericStats);
    const catCols = Object.keys(stats.categoricalStats);
    
    // Bar chart: top categorical vs numeric
    if (catCols.length > 0 && numericCols.length > 0) {
        charts.push({
            type: 'bar',
            x: catCols[0],
            y: numericCols[0],
            reason: `Distribution of ${numericCols[0]} by ${catCols[0]}`
        });
    }
    
    // Line chart: if we have a date column
    const dateCols = headers.filter(h => {
        const sample = rows.slice(0, 10).map(r => r[h]).filter(v => v);
        return sample.some(v => !isNaN(Date.parse(v)));
    });
    if (dateCols.length > 0 && numericCols.length > 0) {
        charts.push({
            type: 'line',
            x: dateCols[0],
            y: numericCols[0],
            reason: `Trend of ${numericCols[0]} over ${dateCols[0]}`
        });
    }
    
    // Pie chart: categorical distribution
    if (catCols.length > 0) {
        const col = catCols[0];
        const uniqueVals = new Set(rows.map(r => String(r[col] || '').trim()).filter(v => v));
        if (uniqueVals.size >= 2 && uniqueVals.size <= 10) {
            charts.push({
                type: 'pie',
                x: col,
                y: null,
                reason: `Distribution of ${col} categories`
            });
        }
    }
    
    // Scatter plot: two numeric columns
    if (numericCols.length >= 2) {
        charts.push({
            type: 'scatter',
            x: numericCols[0],
            y: numericCols[1],
            reason: `Relationship between ${numericCols[0]} and ${numericCols[1]}`
        });
    }
    
    return charts.slice(0, 4);
}

/* ---------- GENERATE INSIGHTS ---------- */
function generateInsights(headers, rows, stats) {
    const insights = [];
    const numericCols = Object.keys(stats.numericStats);
    const catCols = Object.keys(stats.categoricalStats);
    
    // 1. Basic stats
    if (stats.rowCount > 0) {
        insights.push(`Dataset contains ${stats.rowCount.toLocaleString()} rows across ${headers.length} columns.`);
    }
    
    // 2. Missing data
    if (stats.missingValues > 0) {
        const missingPct = ((stats.missingValues / (stats.rowCount * headers.length)) * 100);
        insights.push(`Missing values: ${stats.missingValues.toLocaleString()} (${missingPct.toFixed(1)}% of all cells).`);
    }
    
    // 3. Duplicate rows
    if (stats.duplicateRows > 0) {
        insights.push(`Found ${stats.duplicateRows.toLocaleString()} duplicate rows.`);
    }
    
    // 4. Numeric insights
    numericCols.forEach(col => {
        const colStats = stats.numericStats[col];
        if (colStats) {
            insights.push(`${col}: avg ${formatNumber(colStats.avg)}, range ${formatNumber(colStats.min)} - ${formatNumber(colStats.max)}`);
        }
    });
    
    // 5. Categorical insights
    catCols.forEach(col => {
        const colStats = stats.categoricalStats[col];
        if (colStats && colStats.unique > 1) {
            insights.push(`${col}: ${colStats.unique} unique values, top: "${colStats.top}" (${colStats.topCount} rows)`);
        }
    });
    
    // Limit to 6 insights
    return insights.slice(0, 6);
}

/* ---------- QUALITY CHECKS ---------- */
function checkQuality(headers, rows, stats) {
    const warnings = [];
    
    // Check for high missing values
    const totalCells = stats.rowCount * headers.length;
    if (stats.missingValues > totalCells * 0.2) {
        warnings.push(`High missing data: ${((stats.missingValues/totalCells)*100).toFixed(1)}% of cells are empty`);
    }
    
    // Check for low row count
    if (stats.rowCount < 10) {
        warnings.push('Dataset has very few rows (< 10) — insights may be limited');
    }
    
    // Check for columns with all unique values (potential IDs)
    headers.forEach(h => {
        const colStats = stats.categoricalStats[h];
        if (colStats && colStats.unique === stats.rowCount && stats.rowCount > 10) {
            warnings.push(`Column "${h}" appears to be a unique identifier (all values unique)`);
        }
    });
    
    // Check for columns with very low variance
    const numericCols = Object.keys(stats.numericStats);
    numericCols.forEach(col => {
        const colStats = stats.numericStats[col];
        if (colStats && colStats.max === colStats.min && stats.rowCount > 5) {
            warnings.push(`Column "${col}" has constant value (${colStats.max})`);
        }
    });
    
    return warnings;
}

/* ---------- RENDER FUNCTIONS ---------- */
function renderDatasetTabs() {
    const container = dom.datasetTabs;
    container.innerHTML = '';
    if (state.datasets.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';
    state.datasets.forEach((ds, idx) => {
        const tab = document.createElement('div');
        tab.className = `dataset-tab ${idx === state.currentDatasetIndex ? 'active' : ''}`;
        tab.textContent = ds.name || `Dataset ${idx + 1}`;
        tab.addEventListener('click', () => switchDataset(idx));
        container.appendChild(tab);
    });
}

function switchDataset(index) {
    if (index === state.currentDatasetIndex) return;
    state.currentDatasetIndex = index;
    state.currentPage = 1;
    state.filters = {};
    state.globalSearch = '';
    const dataset = getCurrentDataset();
    if (dataset) {
        state.visibleColumns = new Set(dataset.headers);
        dom.globalSearch.value = '';
    }
    renderDatasetTabs();
    renderAll();
}

function getCurrentDataset() {
    if (state.currentDatasetIndex < 0 || state.currentDatasetIndex >= state.datasets.length) {
        return null;
    }
    return state.datasets[state.currentDatasetIndex];
}

function renderAll() {
    const dataset = getCurrentDataset();
    if (!dataset) {
        dom.uploadSection.style.display = 'flex';
        dom.dashboardSection.style.display = 'none';
        return;
    }
    dom.uploadSection.style.display = 'none';
    dom.dashboardSection.style.display = 'block';
    dom.exportCsvBtn.disabled = false;
    
    renderStats(dataset);
    renderQuality(dataset);
    renderCharts(dataset);
    renderInsights(dataset);
    renderColumnVisibilityPanel(dataset);
    renderTable(dataset);
}

/* ---------- RENDER STATS ---------- */
function renderStats(dataset) {
    const { headers, rows, stats } = dataset;
    const container = dom.statsRow;
    container.innerHTML = '';
    
    const statItems = [
        { label: 'Total Rows', value: stats.rowCount.toLocaleString() },
        { label: 'Total Columns', value: stats.columnCount },
        { label: 'Missing Values', value: stats.missingValues.toLocaleString() },
        { label: 'Duplicate Rows', value: stats.duplicateRows.toLocaleString() },
    ];
    
    if (stats.primaryNumericColumn) {
        const numStats = stats.numericStats[stats.primaryNumericColumn];
        if (numStats) {
            statItems.push({ label: `Avg ${stats.primaryNumericColumn}`, value: formatNumber(numStats.avg) });
            statItems.push({ label: `Max ${stats.primaryNumericColumn}`, value: formatNumber(numStats.max) });
        }
    }
    
    statItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'stat-card glass';
        card.innerHTML = `
            <div class="stat-value">${item.value}</div>
            <div class="stat-label">${item.label}</div>
        `;
        container.appendChild(card);
    });
}

/* ---------- RENDER QUALITY ---------- */
function renderQuality(dataset) {
    const container = dom.qualityChips;
    container.innerHTML = '';
    const warnings = dataset.quality || [];
    
    if (warnings.length === 0) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = '✅ No quality issues detected';
        container.appendChild(chip);
        return;
    }
    
    warnings.forEach(w => {
        const chip = document.createElement('span');
        chip.className = 'chip warning';
        chip.textContent = '⚠ ' + w;
        container.appendChild(chip);
    });
}

/* ---------- RENDER CHARTS ---------- */
function renderCharts(dataset) {
    const container = dom.recommendedCharts;
    container.innerHTML = '';
    const charts = dataset.charts || [];
    
    if (charts.length === 0) {
        container.innerHTML = '<p class="empty-state-text">No charts recommended for this dataset.</p>';
        return;
    }
    
    charts.forEach((chart, idx) => {
        const card = document.createElement('div');
        card.className = 'chart-card glass';
        card.innerHTML = `
            <h4>
                ${getChartIcon(chart.type)} ${chart.type.charAt(0).toUpperCase() + chart.type.slice(1)}
                <span class="recommended-badge">Recommended</span>
                <span style="font-size:0.8rem;color:var(--text-secondary);font-weight:normal;margin-left:auto;">
                    ${chart.x} ${chart.y ? 'vs ' + chart.y : ''}
                </span>
            </h4>
            <div id="chart-${idx}" class="chart-container"></div>
            <p style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.5rem;">${chart.reason}</p>
        `;
        container.appendChild(card);
        
        requestAnimationFrame(() => {
            const containerEl = document.getElementById(`chart-${idx}`);
            if (containerEl) {
                renderSimpleChart(containerEl, dataset, chart);
            }
        });
    });
}

function getChartIcon(type) {
    const icons = {
        bar: '📊',
        line: '📈',
        pie: '🍩',
        scatter: '🔹',
        histogram: '📊'
    };
    return icons[type] || '📊';
}

function renderSimpleChart(container, dataset, chartSpec) {
    const { headers, rows } = dataset;
    const xCol = chartSpec.x;
    const yCol = chartSpec.y;
    const type = chartSpec.type;
    
    // Prepare data
    const data = rows.map(row => ({
        x: row[xCol] || '',
        y: yCol ? parseFloat(row[yCol]) || 0 : 1
    }));
    
    // Aggregate if needed for categories
    let chartData;
    if (type === 'pie' || type === 'bar') {
        const agg = {};
        data.forEach(d => {
            const key = String(d.x).trim() || '(empty)';
            agg[key] = (agg[key] || 0) + d.y;
        });
        chartData = Object.entries(agg).map(([label, value]) => ({ label, value }));
    } else {
        chartData = data;
    }
    
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 300;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    let svg = `<svg width="${width}" height="${height}" style="background:transparent;font-family:sans-serif;">`;
    
    if (chartData.length === 0) {
        svg += `<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="var(--text-secondary)">No data</text>`;
        svg += '</svg>';
        container.innerHTML = svg;
        return;
    }
    
    const hasValues = chartData.some(d => typeof d.value === 'number' && !isNaN(d.value));
    if (!hasValues) {
        svg += `<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="var(--text-secondary)">Numeric data required</text>`;
        svg += '</svg>';
        container.innerHTML = svg;
        return;
    }
    
    const values = chartData.map(d => d.value);
    const maxVal = Math.max(...values) || 1;
    const minVal = Math.min(0, ...values);
    const range = maxVal - minVal || 1;
    const colors = ['#39ff14', '#00f0ff', '#b026ff', '#ff2e88', '#ffbe0b', '#ff6b35', '#4ecdc4', '#45b7d1'];
    
    if (type === 'pie') {
        const total = values.reduce((a, b) => a + b, 0);
        let startAngle = -Math.PI / 2;
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) / 2 - 30;
        
        chartData.forEach((d, i) => {
            const sliceAngle = (d.value / total) * 2 * Math.PI;
            const endAngle = startAngle + sliceAngle;
            const x1 = cx + radius * Math.cos(startAngle);
            const y1 = cy + radius * Math.sin(startAngle);
            const x2 = cx + radius * Math.cos(endAngle);
            const y2 = cy + radius * Math.sin(endAngle);
            const largeArc = sliceAngle > Math.PI ? 1 : 0;
            const color = colors[i % colors.length];
            svg += `<path d="M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${largeArc},1 ${x2},${y2} Z" 
                       fill="${color}" stroke="var(--bg-primary)" stroke-width="2" />`;
            svg += `<text x="${cx + (radius * 0.6) * Math.cos(startAngle + sliceAngle/2)}" 
                          y="${cy + (radius * 0.6) * Math.sin(startAngle + sliceAngle/2)}" 
                          text-anchor="middle" fill="white" font-size="11" font-weight="bold">${Math.round(d.value/total*100)}%</text>`;
            startAngle = endAngle;
        });
        
        const legendY = height - 20;
        let legendX = padding.left;
        chartData.forEach((d, i) => {
            const color = colors[i % colors.length];
            const text = String(d.label).substring(0, 15) + (String(d.label).length > 15 ? '…' : '');
            svg += `<rect x="${legendX}" y="${legendY}" width="10" height="10" fill="${color}" rx="2" />`;
            svg += `<text x="${legendX + 14}" y="${legendY + 9}" fill="var(--text-secondary)" font-size="10">${text}</text>`;
            legendX += 14 + text.length * 6 + 8;
        });
        
    } else if (type === 'bar') {
        const barWidth = Math.min(chartWidth / chartData.length * 0.7, 60);
        const gap = chartWidth / chartData.length;
        const baseline = padding.top + chartHeight;
        
        svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${baseline}" stroke="var(--glass-border)" stroke-width="1" />`;
        svg += `<line x1="${padding.left}" y1="${baseline}" x2="${width - padding.right}" y2="${baseline}" stroke="var(--glass-border)" stroke-width="1" />`;
        
        const numTicks = 5;
        for (let i = 0; i <= numTicks; i++) {
            const val = minVal + (range * i / numTicks);
            const yPos = baseline - (val - minVal) / range * chartHeight;
            svg += `<text x="${padding.left - 8}" y="${yPos + 4}" text-anchor="end" fill="var(--text-secondary)" font-size="10">${Math.round(val)}</text>`;
            svg += `<line x1="${padding.left - 4}" y1="${yPos}" x2="${padding.left}" y2="${yPos}" stroke="var(--glass-border)" stroke-width="1" />`;
        }
        
        chartData.forEach((d, i) => {
            const xPos = padding.left + (i * gap) + (gap - barWidth) / 2;
            const barHeight = Math.max((d.value - minVal) / range * chartHeight, 1);
            const yPos = baseline - barHeight;
            const color = colors[i % colors.length];
            svg += `<rect x="${xPos}" y="${yPos}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="2" opacity="0.8" />`;
            svg += `<text x="${xPos + barWidth/2}" y="${yPos - 4}" text-anchor="middle" fill="var(--text-primary)" font-size="10">${formatNumber(d.value)}</text>`;
            const label = String(d.label).substring(0, 12) + (String(d.label).length > 12 ? '…' : '');
            svg += `<text x="${xPos + barWidth/2}" y="${baseline + 16}" text-anchor="middle" fill="var(--text-secondary)" font-size="9" transform="rotate(-15, ${xPos + barWidth/2}, ${baseline + 16})">${label}</text>`;
        });
        
    } else if (type === 'line') {
        const baseline = padding.top + chartHeight;
        svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${baseline}" stroke="var(--glass-border)" stroke-width="1" />`;
        svg += `<line x1="${padding.left}" y1="${baseline}" x2="${width - padding.right}" y2="${baseline}" stroke="var(--glass-border)" stroke-width="1" />`;
        
        const numTicks = 5;
        for (let i = 0; i <= numTicks; i++) {
            const val = minVal + (range * i / numTicks);
            const yPos = baseline - (val - minVal) / range * chartHeight;
            svg += `<text x="${padding.left - 8}" y="${yPos + 4}" text-anchor="end" fill="var(--text-secondary)" font-size="10">${Math.round(val)}</text>`;
        }
        
        if (chartData.length > 1) {
            const points = chartData.map((d, i) => {
                const x = padding.left + (i / (chartData.length - 1)) * chartWidth;
                const y = baseline - (d.value - minVal) / range * chartHeight;
                return { x, y, label: d.label, value: d.value };
            });
            
            svg += `<polyline points="${points.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#00f0ff" stroke-width="2.5" />`;
            const areaPoints = points.map(p => `${p.x},${p.y}`).join(' ') + ` ${points[points.length-1].x},${baseline} ${points[0].x},${baseline}`;
            svg += `<polygon points="${areaPoints}" fill="rgba(0, 240, 255, 0.1)" />`;
            
            points.forEach((p, i) => {
                svg += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#00f0ff" />`;
                const label = String(p.label).substring(0, 10);
                svg += `<text x="${p.x}" y="${baseline + 16}" text-anchor="middle" fill="var(--text-secondary)" font-size="8" transform="rotate(-20, ${p.x}, ${baseline + 16})">${label}</text>`;
                svg += `<text x="${p.x}" y="${p.y - 8}" text-anchor="middle" fill="var(--text-primary)" font-size="9">${formatNumber(p.value)}</text>`;
            });
        } else {
            svg += `<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="var(--text-secondary)">Need at least 2 data points</text>`;
        }
        
    } else if (type === 'scatter') {
        const baseline = padding.top + chartHeight;
        svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${baseline}" stroke="var(--glass-border)" stroke-width="1" />`;
        svg += `<line x1="${padding.left}" y1="${baseline}" x2="${width - padding.right}" y2="${baseline}" stroke="var(--glass-border)" stroke-width="1" />`;
        
        const numTicks = 4;
        for (let i = 0; i <= numTicks; i++) {
            const val = minVal + (range * i / numTicks);
            const yPos = baseline - (val - minVal) / range * chartHeight;
            svg += `<text x="${padding.left - 8}" y="${yPos + 4}" text-anchor="end" fill="var(--text-secondary)" font-size="10">${Math.round(val)}</text>`;
        }
        
        const xValues = chartData.map(d => typeof d.x === 'number' ? d.x : 0);
        const xMin = Math.min(0, ...xValues);
        const xMax = Math.max(1, ...xValues);
        const xRange = xMax - xMin || 1;
        
        chartData.forEach((d, i) => {
            const xVal = typeof d.x === 'number' ? d.x : i / Math.max(chartData.length - 1, 1);
            const xPos = padding.left + (xVal - xMin) / xRange * chartWidth;
            const yPos = baseline - (d.value - minVal) / range * chartHeight;
            const color = colors[i % colors.length];
            svg += `<circle cx="${xPos}" cy="${yPos}" r="6" fill="${color}" opacity="0.7" />`;
            svg += `<text x="${xPos}" y="${yPos - 10}" text-anchor="middle" fill="var(--text-secondary)" font-size="8">${formatNumber(d.value)}</text>`;
        });
        
        svg += `<text x="${width/2}" y="${height - 4}" text-anchor="middle" fill="var(--text-secondary)" font-size="10">${xCol}</text>`;
        svg += `<text x="12" y="${height/2}" text-anchor="middle" fill="var(--text-secondary)" font-size="10" transform="rotate(-90, 12, ${height/2})">${yCol || 'Value'}</text>`;
        
    } else {
        // Fallback: simple bar
        const barWidth = Math.min(chartWidth / chartData.length * 0.6, 50);
        const gap = chartWidth / chartData.length;
        const baseline = padding.top + chartHeight;
        chartData.forEach((d, i) => {
            const xPos = padding.left + (i * gap) + (gap - barWidth) / 2;
            const barHeight = Math.max((d.value - minVal) / range * chartHeight, 1);
            const yPos = baseline - barHeight;
            const color = colors[i % colors.length];
            svg += `<rect x="${xPos}" y="${yPos}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="2" opacity="0.8" />`;
            const label = String(d.label).substring(0, 8);
            svg += `<text x="${xPos + barWidth/2}" y="${baseline + 14}" text-anchor="middle" fill="var(--text-secondary)" font-size="8">${label}</text>`;
        });
    }
    
    svg += '</svg>';
    container.innerHTML = svg;
}

/* ---------- RENDER INSIGHTS ---------- */
function renderInsights(dataset) {
    const container = dom.insightsCards;
    container.innerHTML = '';
    const insights = dataset.insights || [];
    
    if (insights.length === 0) {
        container.innerHTML = '<p class="empty-state-text">No insights generated.</p>';
        return;
    }
    
    insights.forEach((insight, i) => {
        const card = document.createElement('div');
        card.className = `insight-card glass ${i % 2 === 0 ? 'highlight' : ''}`;
        card.innerHTML = `<p style="font-size:1rem;">💡 ${insight}</p>`;
        container.appendChild(card);
    });
}

/* ---------- RENDER TABLE ---------- */
function renderColumnVisibilityPanel(dataset) {
    const container = dom.columnVisibilityPanel;
    container.innerHTML = '';
    const headers = dataset.headers;
    
    headers.forEach(h => {
        const label = document.createElement('label');
        label.className = 'column-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.visibleColumns.has(h);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                state.visibleColumns.add(h);
            } else {
                state.visibleColumns.delete(h);
            }
            renderTable(dataset);
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(h));
        container.appendChild(label);
    });
}

function renderTable(dataset) {
    if (!dataset) return;
    
    const { headers, rows } = dataset;
    const visibleHeaders = headers.filter(h => state.visibleColumns.has(h));
    
    let filteredRows = rows.filter(row => {
        if (state.globalSearch) {
            const search = state.globalSearch.toLowerCase();
            const match = visibleHeaders.some(h => 
                String(row[h] || '').toLowerCase().includes(search)
            );
            if (!match) return false;
        }
        for (const [col, filter] of Object.entries(state.filters)) {
            if (!filter) continue;
            const val = String(row[col] || '').toLowerCase();
            if (!val.includes(filter.toLowerCase())) return false;
        }
        return true;
    });
    
    if (state.sortColumn && visibleHeaders.includes(state.sortColumn)) {
        filteredRows.sort((a, b) => {
            const aVal = a[state.sortColumn] || '';
            const bVal = b[state.sortColumn] || '';
            const compare = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return state.sortDirection === 'asc' ? compare : -compare;
        });
    }
    
    const totalRows = filteredRows.length;
    const totalPages = Math.ceil(totalRows / state.pageSize) || 1;
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    const start = (state.currentPage - 1) * state.pageSize;
    const end = Math.min(start + state.pageSize, totalRows);
    const pageRows = filteredRows.slice(start, end);
    
    const thead = dom.tableHead;
    thead.innerHTML = '';
    const headerRow = document.createElement('tr');
    visibleHeaders.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        th.addEventListener('click', () => {
            if (state.sortColumn === h) {
                state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortColumn = h;
                state.sortDirection = 'asc';
            }
            renderTable(dataset);
        });
        if (state.sortColumn === h) {
            th.textContent += state.sortDirection === 'asc' ? ' ↑' : ' ↓';
        }
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    
    const tbody = dom.tableBody;
    tbody.innerHTML = '';
    
    if (pageRows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = visibleHeaders.length;
        td.textContent = 'No rows match your filters.';
        td.style.textAlign = 'center';
        td.style.padding = '2rem';
        td.style.color = 'var(--text-secondary)';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        pageRows.forEach(row => {
            const tr = document.createElement('tr');
            visibleHeaders.forEach(h => {
                const td = document.createElement('td');
                td.textContent = row[h] !== undefined && row[h] !== null ? row[h] : '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
    
    dom.pageInfo.textContent = `Page ${state.currentPage} of ${totalPages} (${totalRows} rows)`;
    dom.prevPage.disabled = state.currentPage <= 1;
    dom.nextPage.disabled = state.currentPage >= totalPages;
}

/* ---------- UPLOAD HANDLING ---------- */
function initUpload() {
    const dropZone = dom.dropZone;
    const fileInput = dom.fileInput;
    const browseBtn = dom.browseBtn;
    const analyzeBtn = dom.analyzeBtn;
    const progressFill = dom.progressFill;
    const uploadProgress = dom.uploadProgress;
    
    let currentFile = null;
    
    // Browse button
    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    
    // Drop zone click
    dropZone.addEventListener('click', () => fileInput.click());
    
    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            currentFile = e.target.files[0];
            handleFile(currentFile);
        }
    });
    
    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            currentFile = e.dataTransfer.files[0];
            handleFile(currentFile);
        }
    });
    
    // Analyze button
    analyzeBtn.addEventListener('click', () => {
        if (currentFile) {
            processFile(currentFile);
        }
    });
    
    function handleFile(file) {
        const ext = getFileExtension(file.name);
        if (ext !== 'csv') {
            alert('Please upload a CSV file.');
            return;
        }
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = `📊 Analyze "${file.name}"`;
    }
    
    function processFile(file) {
        if (state.isUploading) return;
        state.isUploading = true;
        analyzeBtn.disabled = true;
        uploadProgress.style.display = 'block';
        progressFill.style.width = '0%';
        
        const reader = new FileReader();
        reader.onprogress = (e) => {
            if (e.total) {
                const pct = (e.loaded / e.total) * 100;
                progressFill.style.width = pct + '%';
            }
        };
        
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                progressFill.style.width = '60%';
                
                const { headers, rows } = parseCSV(text);
                const stats = computeStatistics(headers, rows);
                const quality = checkQuality(headers, rows, stats);
                const charts = generateCharts(headers, rows, stats);
                const insights = generateInsights(headers, rows, stats);
                
                const dataset = {
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    headers,
                    rows,
                    stats,
                    quality,
                    charts,
                    insights
                };
                
                state.datasets.push(dataset);
                state.currentDatasetIndex = state.datasets.length - 1;
                state.visibleColumns = new Set(headers);
                state.currentPage = 1;
                state.globalSearch = '';
                dom.globalSearch.value = '';
                
                progressFill.style.width = '100%';
                
                renderDatasetTabs();
                renderAll();
                
                analyzeBtn.textContent = '✅ Loaded!';
                setTimeout(() => {
                    analyzeBtn.textContent = 'Analyze Dataset';
                    analyzeBtn.disabled = true;
                }, 2000);
                
                console.log('📊 Dataset loaded:', dataset.name, rows.length, 'rows');
                
            } catch (err) {
                console.error('Error processing file:', err);
                alert('Error processing file: ' + err.message);
            } finally {
                state.isUploading = false;
                setTimeout(() => {
                    uploadProgress.style.display = 'none';
                    progressFill.style.width = '0%';
                }, 500);
            }
        };
        
        reader.onerror = () => {
            state.isUploading = false;
            analyzeBtn.disabled = false;
            uploadProgress.style.display = 'none';
            alert('Error reading file.');
        };
        
        reader.readAsText(file);
    }
}

/* ---------- PAGINATION EVENTS ---------- */
function initPagination() {
    dom.prevPage.addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            renderTable(getCurrentDataset());
        }
    });
    
    dom.nextPage.addEventListener('click', () => {
        const dataset = getCurrentDataset();
        if (dataset) {
            const totalRows = dataset.rows.length;
            const totalPages = Math.ceil(totalRows / state.pageSize);
            if (state.currentPage < totalPages) {
                state.currentPage++;
                renderTable(dataset);
            }
        }
    });
    
    dom.pageSize.addEventListener('change', (e) => {
        state.pageSize = parseInt(e.target.value);
        state.currentPage = 1;
        renderTable(getCurrentDataset());
    });
    
    dom.globalSearch.addEventListener('input', debounce((e) => {
        state.globalSearch = e.target.value;
        state.currentPage = 1;
        renderTable(getCurrentDataset());
    }, 300));
    
    dom.columnToggleBtn.addEventListener('click', () => {
        const panel = dom.columnVisibilityPanel;
        panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    });
}

/* ---------- EXPORT CSV ---------- */
function initExport() {
    dom.exportCsvBtn.addEventListener('click', () => {
        const dataset = getCurrentDataset();
        if (!dataset) return;
        
        const { headers, rows } = dataset;
        const visibleHeaders = headers.filter(h => state.visibleColumns.has(h));
        
        let csv = visibleHeaders.join(',') + '\n';
        rows.forEach(row => {
            const values = visibleHeaders.map(h => {
                let val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    val = '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            });
            csv += values.join(',') + '\n';
        });
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${dataset.name}_export.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

/* ---------- CUSTOM CHART BUILDER ---------- */
function initChartBuilder() {
    dom.buildChartBtn.addEventListener('click', () => {
        const dataset = getCurrentDataset();
        if (!dataset) return;
        
        const xSelect = dom.xAxisSelect;
        const ySelect = dom.yAxisSelect;
        xSelect.innerHTML = '';
        ySelect.innerHTML = '';
        
        const headers = dataset.headers;
        headers.forEach(h => {
            const opt1 = document.createElement('option');
            opt1.value = h;
            opt1.textContent = h;
            xSelect.appendChild(opt1);
            
            const opt2 = document.createElement('option');
            opt2.value = h;
            opt2.textContent = h;
            ySelect.appendChild(opt2);
        });
        
        dom.chartModal.style.display = 'flex';
    });
    
    dom.closeChartModal.addEventListener('click', () => {
        dom.chartModal.style.display = 'none';
    });
    
    dom.chartModal.addEventListener('click', (e) => {
        if (e.target === dom.chartModal) {
            dom.chartModal.style.display = 'none';
        }
    });
    
    dom.renderCustomChartBtn.addEventListener('click', () => {
        const dataset = getCurrentDataset();
        if (!dataset) return;
        
        const chartType = dom.chartTypeSelect.value;
        const xCol = dom.xAxisSelect.value;
        const yCol = dom.yAxisSelect.value;
        
        const chartSpec = {
            type: chartType,
            x: xCol,
            y: yCol || null,
            reason: 'Custom chart'
        };
        
        const container = dom.customChartContainer;
        container.innerHTML = '';
        renderSimpleChart(container, dataset, chartSpec);
    });
}

/* ---------- THEME ---------- */
function initTheme() {
    // Load saved theme
    const savedTheme = localStorage.getItem('datalens-theme') || 'dark';
    state.theme = savedTheme;
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
    }
    
    dom.themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        state.theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
        localStorage.setItem('datalens-theme', state.theme);
    });
}

/* ---------- NEW DATASET ---------- */
function initNewDataset() {
    dom.newDatasetBtn.addEventListener('click', () => {
        resetToUpload();
    });
}

function resetToUpload() {
    dom.uploadSection.style.display = 'flex';
    dom.dashboardSection.style.display = 'none';
    dom.fileInput.value = '';
    dom.analyzeBtn.disabled = true;
    dom.analyzeBtn.textContent = 'Analyze Dataset';
    dom.exportCsvBtn.disabled = true;
}

/* ---------- KEYBOARD SHORTCUTS ---------- */
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            dom.globalSearch.focus();
        }
        if (e.key === 'Escape') {
            dom.chartModal.style.display = 'none';
        }
    });
}

/* ---------- INITIALIZATION ---------- */
function init() {
    initTheme();
    initUpload();
    initPagination();
    initExport();
    initChartBuilder();
    initNewDataset();
    initKeyboardShortcuts();
    resetToUpload();
    
    console.log('📊 DataLens initialized');
    console.log('ℹ️  Press Ctrl+K to search, Escape to close modal');
}

// Handle window resize for charts
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const dataset = getCurrentDataset();
        if (dataset) {
            renderCharts(dataset);
        }
    }, 500);
});

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', init);

// Export for debugging
window.__datalens = {
    state,
    getCurrentDataset,
    renderAll,
    switchDataset
};