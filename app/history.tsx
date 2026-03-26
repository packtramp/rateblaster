import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Platform, Dimensions, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Colors } from '../constants/colors';
import Svg, { Line, Circle, Text as SvgText, Rect, G } from 'react-native-svg';

interface RateEntry {
  date: string;
  conventional?: { rate: number; apr?: number };
  fha?: { rate: number; apr?: number };
  va?: { rate: number; apr?: number };
  usda?: { rate: number; apr?: number };
  jumbo?: { rate: number; apr?: number };
  nonqm?: { rate: number; apr?: number };
}

type TimeRange = '10' | '30' | '60' | '90' | 'q4prev' | 'q1' | 'q2' | 'q3' | 'q4' | 'ytd' | '6mo' | 'lastyear' | 'all';
type RateKey = 'conventional' | 'fha' | 'va' | 'usda' | 'jumbo' | 'nonqm';

const RATE_COLORS: Record<RateKey, string> = {
  conventional: '#3182CE', fha: '#38A169', va: '#DD6B20',
  usda: '#805AD5', jumbo: '#D53F8C', nonqm: '#718096',
};
const RATE_LABELS: Record<RateKey, string> = {
  conventional: 'Conv', fha: 'FHA', va: 'VA',
  usda: 'USDA', jumbo: 'Jumbo', nonqm: 'Non-QM',
};

// ─── CUSTOM SVG CHART (supports gaps in data) ───
function RateChart({ data, activeKeys, width }: {
  data: RateEntry[]; activeKeys: RateKey[]; width: number;
}) {
  if (data.length < 1 || activeKeys.length === 0) return null;

  const padding = { top: 20, right: 16, bottom: 40, left: 52 };
  const chartW = width - padding.left - padding.right;
  const chartH = 260;
  const height = chartH + padding.top + padding.bottom;

  const getVal = (e: RateEntry, k: RateKey): number | null => {
    const v = k === 'nonqm' ? e.nonqm?.rate : (e as any)[k]?.rate;
    return v || null;
  };

  // Find Y bounds from selected types (only real values)
  const allVals: number[] = [];
  activeKeys.forEach((k) => data.forEach((e) => {
    const v = getVal(e, k);
    if (v) allVals.push(v);
  }));
  if (allVals.length === 0) return null;

  const yMin = Math.floor((Math.min(...allVals) - 0.125) * 8) / 8;
  const yMax = Math.ceil((Math.max(...allVals) + 0.125) * 8) / 8;
  const yRange = yMax - yMin || 1;

  const xScale = (i: number) => padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
  const yScale = (v: number) => padding.top + chartH - ((v - yMin) / yRange) * chartH;

  // Y-axis labels (5 ticks)
  const yTicks = Array.from({ length: 6 }, (_, i) => yMin + (yRange * i) / 5);

  // X-axis labels
  const labelInterval = Math.max(1, Math.floor(data.length / 6));
  const xLabels = data.map((e, i) => {
    if (i % labelInterval === 0 || i === data.length - 1) {
      const p = e.date.split('-');
      return { i, label: `${p[1]}/${p[2]}` };
    }
    return null;
  }).filter(Boolean) as { i: number; label: string }[];

  return (
    <Svg width={width} height={height}>
      {/* Background */}
      <Rect x={padding.left} y={padding.top} width={chartW} height={chartH} fill="#f7fafc" rx={4} />

      {/* Grid lines + Y labels */}
      {yTicks.map((tick, i) => (
        <G key={`y${i}`}>
          <Line
            x1={padding.left} y1={yScale(tick)}
            x2={padding.left + chartW} y2={yScale(tick)}
            stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4,4"
          />
          <SvgText
            x={padding.left - 6} y={yScale(tick) + 4}
            fontSize={11} fill="#718096" textAnchor="end"
          >
            {tick.toFixed(2)}%
          </SvgText>
        </G>
      ))}

      {/* X labels */}
      {xLabels.map(({ i, label }) => (
        <SvgText
          key={`x${i}`}
          x={xScale(i)} y={padding.top + chartH + 20}
          fontSize={10} fill="#718096" textAnchor="middle"
        >
          {label}
        </SvgText>
      ))}

      {/* Data lines + dots per active type */}
      {activeKeys.map((k) => {
        const points: { x: number; y: number }[] = [];
        const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];

        data.forEach((e, i) => {
          const v = getVal(e, k);
          if (v !== null) {
            const pt = { x: xScale(i), y: yScale(v) };
            if (points.length > 0) {
              const prev = points[points.length - 1];
              segments.push({ x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y });
            }
            points.push(pt);
          }
        });

        return (
          <G key={k}>
            {segments.map((seg, i) => (
              <Line
                key={`${k}-l${i}`}
                x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
                stroke={RATE_COLORS[k]} strokeWidth={2}
              />
            ))}
            {points.map((pt, i) => (
              <Circle
                key={`${k}-d${i}`}
                cx={pt.x} cy={pt.y} r={3}
                fill={RATE_COLORS[k]} stroke="#fff" strokeWidth={1}
              />
            ))}
          </G>
        );
      })}
    </Svg>
  );
}

// ─── MAIN COMPONENT ───
export default function HistoryScreen() {
  const [allData, setAllData] = useState<RateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>('90');
  const [selected, setSelected] = useState<Record<RateKey, boolean>>({
    conventional: true, fha: true, va: true, usda: true, jumbo: true, nonqm: true,
  });

  useEffect(() => { fetchHistory(); }, []);

  async function fetchHistory() {
    try {
      const q = query(collection(db, 'rateHistory'), orderBy('date', 'asc'));
      const snapshot = await getDocs(q);
      const entries: RateEntry[] = [];
      snapshot.forEach((doc) => entries.push(doc.data() as RateEntry));
      setAllData(entries);
    } catch (err) {
      console.error('Failed to fetch rate history:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredData = useMemo(() => {
    if (range === 'all') return allData;
    if (range === '10' || range === '30' || range === '60' || range === '90') {
      const days = parseInt(range);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      return allData.filter((e) => e.date >= cutoffStr);
    }
    if (range === 'q4prev') {
      const year = new Date().getFullYear();
      return allData.filter((e) => e.date >= `${year - 1}-10-01` && e.date <= `${year - 1}-12-31`);
    }
    const now = new Date();
    const year = now.getFullYear();
    const filterByDateRange = (start: string, end: string) =>
      allData.filter((e) => e.date >= start && e.date <= end);
    switch (range) {
      case 'q1': return filterByDateRange(`${year}-01-01`, `${year}-03-31`);
      case 'q2': return filterByDateRange(`${year}-04-01`, `${year}-06-30`);
      case 'q3': return filterByDateRange(`${year}-07-01`, `${year}-09-30`);
      case 'q4': return filterByDateRange(`${year}-10-01`, `${year}-12-31`);
      case 'ytd': return filterByDateRange(`${year}-01-01`, `${year}-12-31`);
      case '6mo': return allData.slice(-130);
      case 'lastyear': return filterByDateRange(`${year - 1}-01-01`, `${year - 1}-12-31`);
      default: return allData;
    }
  }, [allData, range]);

  const tableData = useMemo(() => [...filteredData].reverse(), [filteredData]);
  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.min(screenWidth - 32, 568);

  const hasData: Record<RateKey, boolean> = {
    conventional: true, fha: true, va: true,
    usda: filteredData.filter((e) => e.usda?.rate).length >= 1,
    jumbo: filteredData.filter((e) => e.jumbo?.rate).length >= 1,
    nonqm: filteredData.filter((e) => e.nonqm?.rate).length >= 1,
  };

  const toggleRate = (key: RateKey) => setSelected((p) => ({ ...p, [key]: !p[key] }));
  const activeKeys = (Object.keys(selected) as RateKey[]).filter((k) => selected[k] && hasData[k]);

  function getRateChangeColor(current: number | undefined, previous: number | undefined) {
    if (!current || !previous || current === previous) return {};
    return current < previous ? { color: Colors.success } : { color: Colors.error };
  }

  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={s.loadingText}>Loading rate history...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.logo}>RateBlaster</Text>
        <Text style={s.tagline}>Daily Mortgage Rates, Delivered.</Text>
      </View>

      {/* Range Toggle */}
      <View style={s.toggleRow}>
        {([
          { key: '10' as TimeRange, label: '10D' },
          { key: '30' as TimeRange, label: '30D' },
          { key: '60' as TimeRange, label: '60D' },
          { key: '90' as TimeRange, label: '90D' },
          { key: 'q4prev' as TimeRange, label: 'Q4 \'25' },
          { key: 'q1' as TimeRange, label: 'Q1' },
          { key: 'q2' as TimeRange, label: 'Q2' },
          { key: 'ytd' as TimeRange, label: 'YTD' },
          { key: 'all' as TimeRange, label: 'All' },
        ]).filter(({ key }) => {
          const now = new Date();
          if (key === 'q2') return now.getMonth() >= 3;
          if (key === 'q3') return now.getMonth() >= 6;
          if (key === 'q4') return now.getMonth() >= 9;
          return true;
        }).map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[s.toggleButton, range === key && s.toggleActive]}
            onPress={() => setRange(key)}
            activeOpacity={0.7}
          >
            <Text style={[s.toggleText, range === key && s.toggleTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Chart */}
      <View style={s.card}>
        <Text style={s.sectionTitle}>Rate Trends</Text>
        <View style={s.legendRow}>
          {(Object.keys(RATE_LABELS) as RateKey[]).filter((k) => hasData[k]).map((k) => (
            <TouchableOpacity
              key={k}
              style={[s.checkboxItem, selected[k] && { backgroundColor: RATE_COLORS[k] + '18' }]}
              onPress={() => toggleRate(k)}
              activeOpacity={0.7}
            >
              <View style={[s.checkbox, selected[k] && { backgroundColor: RATE_COLORS[k], borderColor: RATE_COLORS[k] }]}>
                {selected[k] && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={[s.legendLabel, selected[k] && { color: RATE_COLORS[k], fontWeight: '700' }]}>{RATE_LABELS[k]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {activeKeys.length > 0 ? (
          <RateChart data={filteredData} activeKeys={activeKeys} width={chartWidth} />
        ) : (
          <Text style={s.noData}>Select at least one rate type above.</Text>
        )}
      </View>

      {/* Action Buttons */}
      <View style={s.buttonCard}>
        <TouchableOpacity style={s.signupButton} onPress={() => router.push('/')} activeOpacity={0.7}>
          <Text style={s.signupButtonText}>Sign Up for Rates</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.calcButton} onPress={() => Linking.openURL('https://www.dorsettgroup.com/mortgage-calculator.html')} activeOpacity={0.7}>
          <Text style={s.calcButtonText}>Mortgage Calculator</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.applyButton} onPress={() => Linking.openURL('https://roby.zipforhome.com/')} activeOpacity={0.7}>
          <Text style={s.applyButtonText}>Apply Now</Text>
        </TouchableOpacity>
      </View>

      {/* Data Table */}
      <View style={s.card}>
        <Text style={s.sectionTitle}>Rate History</Text>
        <Text style={s.subtitle}>{filteredData.length} entries</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={true}>
        <View>
        <View style={s.tableHeader}>
          <Text style={[s.tableHeaderCell, s.dateCol]}>Date</Text>
          <Text style={[s.tableHeaderCell, s.rateCol]}>Conv</Text>
          <Text style={[s.tableHeaderCell, s.rateCol]}>FHA</Text>
          <Text style={[s.tableHeaderCell, s.rateCol]}>VA</Text>
          <Text style={[s.tableHeaderCell, s.rateCol]}>USDA</Text>
          <Text style={[s.tableHeaderCell, s.rateCol]}>Jumbo</Text>
          <Text style={[s.tableHeaderCell, s.rateCol]}>Non-QM</Text>
        </View>
        {tableData.map((entry, idx) => {
          const prevEntry = idx < tableData.length - 1 ? tableData[idx + 1] : null;
          const dateParts = entry.date.split('-');
          const shortDate = `${dateParts[1]}/${dateParts[2]}`;
          return (
            <View key={entry.date} style={[s.tableRow, idx % 2 === 0 && s.tableRowAlt]}>
              <Text style={[s.tableCell, s.dateCol]}>{shortDate}</Text>
              <Text style={[s.tableCell, s.rateCol, getRateChangeColor(entry.conventional?.rate, prevEntry?.conventional?.rate)]}>
                {entry.conventional?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text style={[s.tableCell, s.rateCol, getRateChangeColor(entry.fha?.rate, prevEntry?.fha?.rate)]}>
                {entry.fha?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text style={[s.tableCell, s.rateCol, getRateChangeColor(entry.va?.rate, prevEntry?.va?.rate)]}>
                {entry.va?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text style={[s.tableCell, s.rateCol, getRateChangeColor(entry.usda?.rate, prevEntry?.usda?.rate)]}>
                {entry.usda?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text style={[s.tableCell, s.rateCol, getRateChangeColor(entry.jumbo?.rate, prevEntry?.jumbo?.rate)]}>
                {entry.jumbo?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text style={[s.tableCell, s.rateCol, getRateChangeColor(entry.nonqm?.rate, prevEntry?.nonqm?.rate)]}>
                {entry.nonqm?.rate?.toFixed(3) ?? '—'}
              </Text>
            </View>
          );
        })}
        </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: 40 },
  header: { backgroundColor: Colors.primary, paddingTop: Platform.OS === 'web' ? 60 : 80, paddingBottom: 40, paddingHorizontal: 24, alignItems: 'center' },
  logo: { fontSize: 36, fontWeight: '800', color: Colors.textLight, letterSpacing: 1 },
  tagline: { fontSize: 16, color: Colors.accent, marginTop: 8, fontWeight: '500' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  loadingText: { marginTop: 12, fontSize: 15, color: Colors.textSecondary },
  toggleRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 16, gap: 8, flexWrap: 'wrap' },
  toggleButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.surface },
  toggleActive: { backgroundColor: Colors.primary },
  toggleText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  toggleTextActive: { color: Colors.textLight },
  card: {
    backgroundColor: Colors.surface, marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 20,
    ...Platform.select({
      web: { maxWidth: 600, alignSelf: 'center' as const, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12 },
      default: { elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
    }),
  },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: Colors.primary, marginBottom: 4 },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  legendRow: { flexDirection: 'row', gap: 8, marginBottom: 12, marginTop: 8, flexWrap: 'wrap' },
  checkboxItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  legendLabel: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  noData: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', paddingVertical: 24, fontStyle: 'italic' },
  buttonCard: {
    backgroundColor: Colors.surface, marginHorizontal: 16, marginTop: 16, borderRadius: 12, padding: 24, gap: 10,
    ...Platform.select({
      web: { maxWidth: 600, alignSelf: 'center' as const, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12 },
      default: { elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
    }),
  },
  signupButton: { borderWidth: 2, borderColor: Colors.accent, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  signupButtonText: { color: Colors.accent, fontSize: 16, fontWeight: '700' },
  calcButton: { backgroundColor: Colors.accent, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  calcButtonText: { color: Colors.textLight, fontSize: 16, fontWeight: '700' },
  applyButton: { backgroundColor: Colors.success, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  applyButtonText: { color: Colors.textLight, fontSize: 16, fontWeight: '700' },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: Colors.primary, paddingVertical: 10, minWidth: 580 },
  tableHeaderCell: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  tableRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border, minWidth: 580 },
  tableRowAlt: { backgroundColor: '#f7fafc' },
  tableCell: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  dateCol: { flex: 1 },
  rateCol: { flex: 0.8, textAlign: 'center' },
});
