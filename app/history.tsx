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

export default function HistoryScreen() {
  const [allData, setAllData] = useState<RateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>('all');

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
  const chartWidth = Math.max(screenWidth - 32, filteredData.length * 18);

  // Build chart labels — show every 5th date
  const labels = filteredData.map((entry, i) => {
    if (i % 5 === 0) {
      const parts = entry.date.split('-');
      return `${parts[1]}/${parts[2]}`;
    }
    return '';
  });

  const convRates = filteredData.map((e) => e.conventional?.rate ?? 0);
  const fhaRates = filteredData.map((e) => e.fha?.rate ?? 0);
  const vaRates = filteredData.map((e) => e.va?.rate ?? 0);
  const usdaRates = filteredData.map((e) => e.usda?.rate ?? 0);
  const jumboRates = filteredData.map((e) => e.jumbo?.rate ?? 0);
  const nonqmRates = filteredData.map((e) => e.nonqm?.rate ?? 0);

  // Find min/max for Y-axis — tight bounds with 0.25% padding
  const allRates = [...convRates, ...fhaRates, ...vaRates, ...usdaRates, ...jumboRates, ...nonqmRates].filter((r) => r > 0);
  const dataMin = allRates.length > 0 ? Math.min(...allRates) : 5;
  const dataMax = allRates.length > 0 ? Math.max(...allRates) : 7;
  const minRate = Math.floor((dataMin - 0.25) * 8) / 8;
  const maxRate = Math.ceil((dataMax + 0.25) * 8) / 8;

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
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#3182CE' }]} />
              <Text style={styles.legendLabel}>Conv</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#38A169' }]} />
              <Text style={styles.legendLabel}>FHA</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#DD6B20' }]} />
              <Text style={styles.legendLabel}>VA</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#805AD5' }]} />
              <Text style={styles.legendLabel}>USDA</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#D53F8C' }]} />
              <Text style={styles.legendLabel}>Jumbo</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#718096' }]} />
              <Text style={styles.legendLabel}>Non-QM</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={true}>
            <LineChart
              data={{
                labels,
                datasets: [
                  { data: convRates, color: () => '#3182CE', strokeWidth: 2 },
                  { data: fhaRates, color: () => '#38A169', strokeWidth: 2 },
                  { data: vaRates, color: () => '#DD6B20', strokeWidth: 2 },
                  { data: usdaRates, color: () => '#805AD5', strokeWidth: 2 },
                  { data: jumboRates, color: () => '#D53F8C', strokeWidth: 2 },
                  { data: nonqmRates, color: () => '#718096', strokeWidth: 2 },
                  // Invisible datasets to force Y-axis bounds
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
          </ScrollView>
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
