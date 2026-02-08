import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildApiUrl } from '../config/apiConfig';

const COLORS = {
  background: '#F5F0E6',
  text: '#2C2C2C',
  textLight: '#666666',
  border: '#8B8680',
  borderLight: '#D4D0C4',
  inputBg: '#FFFFFF',
  headerBg: '#D4C4B0',
  headerText: '#2C2C2C',
  accent: '#7A9A7A',
  danger: '#B24636',
  success: '#2E7D32',
};

const ModelEditorScreen = ({ onBack }) => {
  const [template, setTemplate] = useState(null);
  const [jsonText, setJsonText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const fetchTemplate = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(buildApiUrl('/models/template'));
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.details?.join('; ') || data?.error || 'Failed to load template');
      }
      setTemplate(data.template || null);
      if (data.template) {
        setJsonText(JSON.stringify(data.template, null, 2));
      }
    } catch (err) {
      setError(err?.message || 'Failed to load template');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  const handleSave = async () => {
    setError('');
    setSaveMessage('');
    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch (err) {
      setError('JSON is invalid. Please fix and try again.');
      return;
    }
    if (!payload.name || typeof payload.name !== 'string') {
      setError('Model name is required in the JSON payload.');
      return;
    }

    setSaving(true);
    try {
      const resp = await fetch(buildApiUrl('/models'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.details?.join('; ') || data?.error || 'Failed to save model');
      }
      setSaveMessage(`Saved model "${data.name}". It will appear in the chooser.`);
    } catch (err) {
      setError(err?.message || 'Failed to save model');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Model Editor</Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Text style={styles.lead}>Download the default model, adjust parameters or equations, and save as a new model.</Text>

        <View style={styles.rowButtons}>
          <Pressable style={styles.primaryButton} onPress={fetchTemplate} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? 'Loading…' : 'Download default'}</Text>
          </Pressable>
          <Pressable style={[styles.secondaryButton, saving && styles.disabled]} onPress={handleSave} disabled={saving}>
            <Text style={styles.secondaryButtonText}>{saving ? 'Saving…' : 'Save as new model'}</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {saveMessage ? <Text style={styles.success}>{saveMessage}</Text> : null}

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={COLORS.accent} />
            <Text style={styles.textLight}>Loading template…</Text>
          </View>
        )}

        <Text style={styles.label}>Model JSON</Text>
        <TextInput
          multiline
          style={styles.codeInput}
          value={jsonText}
          onChangeText={setJsonText}
          placeholder="Model JSON will appear here"
          placeholderTextColor={COLORS.textLight}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.equationsCard}>
          <Text style={styles.label}>Default equations preview</Text>
          {template?.equations?.length ? (
            template.equations.map((eq) => (
              <View key={eq.title} style={styles.eqRow}>
                <Text style={styles.eqTitle}>{eq.title}</Text>
                <Text style={styles.eqText}>{eq.eq}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.textLight}>No equations available</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    marginRight: 12,
    padding: 8,
    borderRadius: 6,
    backgroundColor: COLORS.headerText,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backText: {
    color: COLORS.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.headerText,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    gap: 12,
  },
  lead: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  rowButtons: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryButton: {
    backgroundColor: COLORS.headerBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.6,
  },
  error: {
    color: COLORS.danger,
    fontSize: 13,
  },
  success: {
    color: COLORS.success,
    fontSize: 13,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  textLight: {
    color: COLORS.textLight,
    fontSize: 13,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  codeInput: {
    minHeight: 260,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.inputBg,
    padding: 12,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: COLORS.text,
    textAlignVertical: 'top',
  },
  equationsCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.inputBg,
    padding: 12,
    gap: 8,
  },
  eqRow: {
    marginBottom: 6,
  },
  eqTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  eqText: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
});

export default ModelEditorScreen;
