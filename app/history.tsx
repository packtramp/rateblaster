import { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Colors } from '../constants/colors';
import { LineChart } from 'react-native-chart-kit';

interface RateEntry {
  date: string;
  conventional?: { rate: number; apr?: number };
  fha?: { rate: number; apr?: number };
  va?: { rate: number; apr?: number };
  usda?: { rate: number; apr?: number };
  jumbo?: { rate: number; apr?: number };
  nonqm?: { rate: number; apr?: number };
}

type TimeRange = '30' | '60' | 'all';

type RateKey = 'conventional' | 'fha' | 'va' | 'usda' | 'jumbo' | 'nonqm';

const RATE_COLORS: Record<RateKey, string> = {
  conventional: '#3182CE',
  fha: '#38A169',
  va: '#DD6B20',
  usda: '#805AD5',
  jumbo: '#D53F8C',
  nonqm: '#718096',
};

const RATE_LABELS: Record<RateKey, string> = {
  conventional: 'Conv',
  fha: 'FHA',
  va: 'VA',
  usda: 'USDA',
  jumbo: 'Jumbo',
  nonqm: 'Non-QM',
};

export default function HistoryScreen() {
  const [allData, setAllData] = useState<RateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>('all');
  const [selected, setSelected] = useState<Record<RateKey, boolean>>({
    conventional: true, fha: true, va: true, usda: true, jumbo: true, nonqm: true,
  });

  useEffect(() => {
    fetchHistory();
  }, []);

  async function fetchHistory() {
    try {
      const q = query(collection(db, 'rateHistory'), orderBy('date', 'asc'));
      const snapshot = await getDocs(q);
      const entries: RateEntry[] = [];
      snapshot.forEach((doc) => {
        entries.push(doc.data() as RateEntry);
      });
      setAllData(entries);
    } catch (err) {
      console.error('Failed to fetch rate history:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredData = useMemo(() => {
    if (range === 'all') return allData;
    const days = range === '30' ? 30 : 60;
    return allData.slice(-days);
  }, [allData, range]);

  const tableData = useMemo(() => [...filteredData].reverse(), [filteredData]);

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.min(screenWidth - 32, 568);

  // Build chart labels — show every 5th date
  const labels = filteredData.map((entry, i) => {
    if (i % 5 === 0) {
      const parts = entry.date.split('-');
      return `${parts[1]}/${parts[2]}`;
    }
    return '';
  });

  // Check which extra types have enough data
  const hasData: Record<RateKey, boolean> = {
    conventional: true,
    fha: true,
    va: true,
    usda: filteredData.filter((e) => e.usda?.rate).length >= 3,
    jumbo: filteredData.filter((e) => e.jumbo?.rate).length >= 3,
    nonqm: filteredData.filter((e) => e.nonqm?.rate).length >= 3,
  };

  const toggleRate = (key: RateKey) => setSelected((p) => ({ ...p, [key]: !p[key] }));

  // Build datasets and Y-axis bounds based on selected types
  const getRates = (key: RateKey) => filteredData.map((e) => {
    const val = key === 'nonqm' ? e.nonqm?.rate : (e as any)[key]?.rate;
    return val || 0;
  });

  const activeKeys = (Object.keys(selected) as RateKey[]).filter((k) => selected[k] && hasData[k]);
  const activeRates = activeKeys.flatMap((k) => getRates(k).filter((r) => r > 0));
  const dataMin = activeRates.length > 0 ? Math.min(...activeRates) : 5;
  const dataMax = activeRates.length > 0 ? Math.max(...activeRates) : 7;
  const minRate = Math.floor((dataMin - 0.125) * 8) / 8;
  const maxRate = Math.ceil((dataMax + 0.125) * 8) / 8;

  function getRateChangeColor(current: number | undefined, previous: number | undefined) {
    if (!current || !previous || current === previous) return {};
    return current < previous
      ? { color: Colors.success }
      : { color: Colors.error };
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading rate history...</Text>
      </View>
    );
  }

  const hasData = filteredData.length > 1;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Range Toggle */}
      <View style={styles.toggleRow}>
        {(['30', '60', 'all'] as TimeRange[]).map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.toggleButton, range === r && styles.toggleActive]}
            onPress={() => setRange(r)}
            activeOpacity={0.7}
          >
            <Text style={[styles.toggleText, range === r && styles.toggleTextActive]}>
              {r === 'all' ? 'All' : `${r} Days`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Chart */}
      {hasData ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Rate Trends</Text>
          {/* Checkboxes to toggle rate types */}
          <View style={styles.legendRow}>
            {(Object.keys(RATE_LABELS) as RateKey[]).filter((k) => hasData[k]).map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.checkboxItem, selected[k] && { backgroundColor: RATE_COLORS[k] + '18' }]}
                onPress={() => toggleRate(k)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, selected[k] && { backgroundColor: RATE_COLORS[k], borderColor: RATE_COLORS[k] }]}>
                  {selected[k] && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={[styles.legendLabel, selected[k] && { color: RATE_COLORS[k], fontWeight: '700' }]}>{RATE_LABELS[k]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {activeKeys.length > 0 && (
            <LineChart
              data={{
                labels,
                datasets: [
                  ...activeKeys.map((k) => ({
                    data: getRates(k).map((v) => v || dataMin),
                    color: () => RATE_COLORS[k],
                    strokeWidth: 2,
                  })),
                  { data: [minRate], color: () => 'transparent', strokeWidth: 0, withDots: false },
                  { data: [maxRate], color: () => 'transparent', strokeWidth: 0, withDots: false },
                ],
              }}
              width={chartWidth}
              height={300}
              yAxisSuffix="%"
              fromZero={false}
              chartConfig={{
                backgroundColor: Colors.surface,
                backgroundGradientFrom: Colors.surface,
                backgroundGradientTo: Colors.surface,
                decimalPlaces: 2,
                color: (opacity = 1) => `rgba(26, 54, 93, ${opacity})`,
                labelColor: () => Colors.textSecondary,
                propsForDots: { r: '3', strokeWidth: '1' },
                propsForBackgroundLines: {
                  strokeDasharray: '4',
                  stroke: Colors.border,
                },
                style: { borderRadius: 8 },
              }}
              style={styles.chart}
              withInnerLines={true}
              withOuterLines={false}
              segments={5}
            />
          )}
          {activeKeys.length === 0 && (
            <Text style={styles.noData}>Select at least one rate type above.</Text>
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.noData}>Not enough data for selected range.</Text>
        </View>
      )}

      {/* Data Table */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Rate History</Text>
        <Text style={styles.subtitle}>{filteredData.length} entries</Text>

        {/* Table Header */}
        <ScrollView horizontal showsHorizontalScrollIndicator={true}>
        <View>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, styles.dateCol]}>Date</Text>
          <Text style={[styles.tableHeaderCell, styles.rateCol]}>Conv</Text>
          <Text style={[styles.tableHeaderCell, styles.rateCol]}>FHA</Text>
          <Text style={[styles.tableHeaderCell, styles.rateCol]}>VA</Text>
          <Text style={[styles.tableHeaderCell, styles.rateCol]}>USDA</Text>
          <Text style={[styles.tableHeaderCell, styles.rateCol]}>Jumbo</Text>
          <Text style={[styles.tableHeaderCell, styles.rateCol]}>Non-QM</Text>
        </View>

        {/* Table Rows */}
        {tableData.map((entry, idx) => {
          // Previous entry is the next in reversed array (older)
          const prevEntry = idx < tableData.length - 1 ? tableData[idx + 1] : null;
          const dateParts = entry.date.split('-');
          const shortDate = `${dateParts[1]}/${dateParts[2]}`;

          return (
            <View
              key={entry.date}
              style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}
            >
              <Text style={[styles.tableCell, styles.dateCol]}>{shortDate}</Text>
              <Text
                style={[
                  styles.tableCell,
                  styles.rateCol,
                  getRateChangeColor(entry.conventional?.rate, prevEntry?.conventional?.rate),
                ]}
              >
                {entry.conventional?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text
                style={[
                  styles.tableCell,
                  styles.rateCol,
                  getRateChangeColor(entry.fha?.rate, prevEntry?.fha?.rate),
                ]}
              >
                {entry.fha?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text
                style={[
                  styles.tableCell,
                  styles.rateCol,
                  getRateChangeColor(entry.va?.rate, prevEntry?.va?.rate),
                ]}
              >
                {entry.va?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text
                style={[
                  styles.tableCell,
                  styles.rateCol,
                  getRateChangeColor(entry.usda?.rate, prevEntry?.usda?.rate),
                ]}
              >
                {entry.usda?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text
                style={[
                  styles.tableCell,
                  styles.rateCol,
                  getRateChangeColor(entry.jumbo?.rate, prevEntry?.jumbo?.rate),
                ]}
              >
                {entry.jumbo?.rate?.toFixed(3) ?? '—'}
              </Text>
              <Text
                style={[
                  styles.tableCell,
                  styles.rateCol,
                  getRateChangeColor(entry.nonqm?.rate, prevEntry?.nonqm?.rate),
                ]}
              >
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: Colors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  toggleButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  toggleActive: {
    backgroundColor: Colors.primary,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  toggleTextActive: {
    color: Colors.textLight,
  },
  card: {
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 20,
    ...Platform.select({
      web: {
        maxWidth: 600,
        alignSelf: 'center' as const,
        width: '100%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      default: {
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
    }),
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  checkboxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  legendLabel: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '500',
  },
  chart: {
    borderRadius: 8,
    marginLeft: -10,
  },
  noData: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 24,
    fontStyle: 'italic',
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
    paddingVertical: 10,
    minWidth: 580,
  },
  tableHeaderCell: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minWidth: 580,
  },
  tableRowAlt: {
    backgroundColor: '#f7fafc',
  },
  tableCell: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500',
  },
  dateCol: {
    flex: 1,
  },
  rateCol: {
    flex: 0.8,
    textAlign: 'center',
  },
});
