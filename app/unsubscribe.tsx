import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { Colors } from '../constants/colors';

export default function UnsubscribeScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleUnsubscribe() {
    if (!email) {
      setError('No email provided.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const q = query(
        collection(db, 'subscribers'),
        where('email', '==', email.toLowerCase())
      );
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setError('Email not found in our records.');
        setLoading(false);
        return;
      }

      const updates = snapshot.docs.map((doc) =>
        updateDoc(doc.ref, { active: false })
      );
      await Promise.all(updates);
      setDone(true);
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {done ? (
          <View style={styles.center}>
            <Text style={styles.doneTitle}>You've been unsubscribed.</Text>
            <Text style={styles.doneText}>Sorry to see you go!</Text>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Unsubscribe from RateBlaster?</Text>
            {email ? (
              <Text style={styles.emailText}>{email}</Text>
            ) : (
              <Text style={styles.errorText}>No email address provided.</Text>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleUnsubscribe}
              disabled={loading || !email}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={Colors.textLight} />
              ) : (
                <Text style={styles.buttonText}>Yes, unsubscribe me</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 32,
    width: '100%',
    ...Platform.select({
      web: {
        maxWidth: 440,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      default: {
        elevation: 3,
      },
    }),
  },
  center: {
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 12,
    textAlign: 'center',
  },
  emailText: {
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  doneTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 8,
  },
  doneText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  button: {
    backgroundColor: Colors.error,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: Colors.textLight,
    fontSize: 16,
    fontWeight: '700',
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
});
