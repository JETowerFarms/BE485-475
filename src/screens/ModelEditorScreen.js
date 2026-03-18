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
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildApiUrl, apiFetch } from '../config/apiConfig';

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
  // Back button (shared across all screens)
  backBtnBg: '#5A554E',
  backBtnBorder: '#3D3A36',
};

const EDITABLE_FIELDS = [
  { key: 'name', label: 'Model name', type: 'text' },
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'discountRate', label: 'Discount rate', type: 'number' },
  { key: 'inflationRate', label: 'Inflation rate', type: 'number' },
  { key: 'electricityEscalation', label: 'Electricity escalation', type: 'number' },
  { key: 'cropEscalation', label: 'Crop escalation', type: 'number' },
  { key: 'projectLife', label: 'Project life (years)', type: 'number' },
  { key: 'landIntensityAcresPerMW', label: 'Land intensity acres per MW', type: 'number' },
  { key: 'degradationRate', label: 'Degradation rate', type: 'number' },
  { key: 'installedCostPerMW', label: 'Installed cost per MW', type: 'number' },
  { key: 'sitePrepCostPerAcre', label: 'Site prep cost per acre', type: 'number' },
  { key: 'gradingCostPerAcre', label: 'Grading cost per acre', type: 'number' },
  { key: 'retilingCostPerAcre', label: 'Retiling cost per acre', type: 'number' },
  { key: 'interconnectionFraction', label: 'Interconnection fraction', type: 'number' },
  { key: 'bondCostPerAcre', label: 'Bond cost per acre', type: 'number' },
  { key: 'vegetationCostPerAcre', label: 'Vegetation cost per acre', type: 'number' },
  { key: 'insuranceCostPerAcre', label: 'Insurance cost per acre', type: 'number' },
  { key: 'oandmCostPerKw', label: 'O&M cost per kW', type: 'number' },
  { key: 'replacementCostPerMW', label: 'Replacement cost per MW', type: 'number' },
  { key: 'replacementYear', label: 'Replacement year', type: 'number' },
  { key: 'decommissionCostPerKw', label: 'Decommission cost per kW', type: 'number' },
  { key: 'remediationCostPerAcre', label: 'Remediation cost per acre', type: 'number' },
  { key: 'salvageValuePerAcre', label: 'Salvage value per acre', type: 'number' },
  { key: 'availabilityFactor', label: 'Availability factor', type: 'number' },
  { key: 'curtailmentFactor', label: 'Curtailment factor', type: 'number' },
  { key: 'exportFactor', label: 'Export factor', type: 'number' },
  { key: 'leaseMinRate', label: 'Lease min rate', type: 'number' },
  { key: 'leaseMaxRate', label: 'Lease max rate', type: 'number' },
  { key: 'leaseEscalationRate', label: 'Lease escalation rate', type: 'number' },
  { key: 'developerRetentionFraction', label: 'Developer retention fraction', type: 'number' },
  { key: 'constraintsMinAgFraction', label: 'Constraints min ag fraction', type: 'number' },
  { key: 'constraintsMaxPrimeSolar', label: 'Constraints max prime solar', type: 'number' },
  { key: 'constraintsZoningMaxSolar', label: 'Constraints zoning max solar', type: 'number' },
  { key: 'constraintsSetbackFraction', label: 'Constraints setback fraction', type: 'number' },
  { key: 'constraintsEasementAcres', label: 'Constraints easement acres', type: 'number' },
  { key: 'constraintsWetlandExclusionAcres', label: 'Constraints wetland exclusion acres', type: 'number' },
  { key: 'constraintsInterconnectCapacityMw', label: 'Constraints interconnect capacity MW', type: 'number' },
  { key: 'farmerPa116CreditPerAcre', label: 'Farmer PA116 credit per acre', type: 'number' },
];

const ModelEditorScreen = ({ onBack }) => {
  const [template, setTemplate] = useState(null);
  const [jsonText, setJsonText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [editableModel, setEditableModel] = useState({});

  const normalizeModel = useCallback((model) => {
    if (!model) return null;
    let equations = null;
    if (Array.isArray(model.equations)) {
      equations = model.equations;
    } else if (typeof model.equations === 'string') {
      try {
        const parsed = JSON.parse(model.equations);
        equations = Array.isArray(parsed) ? parsed : null;
      } catch (err) {
        equations = null;
      }
    }
    return { ...model, equations: equations || [] };
  }, []);

  const hydrateEditable = useCallback((model) => {
    const next = {};
    EDITABLE_FIELDS.forEach(({ key }) => {
      const raw = model && Object.prototype.hasOwnProperty.call(model, key) ? model[key] : '';
      if (raw === null || raw === undefined) {
        next[key] = '';
      } else {
        next[key] = String(raw);
      }
    });
    setEditableModel(next);
  }, []);

  const fetchTemplate = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await apiFetch(buildApiUrl('/models/template'));
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.details?.join('; ') || data?.error || 'Failed to load template');
      }
      const normalized = normalizeModel(data.template || null);
      setTemplate(normalized);
      if (normalized) {
        hydrateEditable(normalized);
        setJsonText(JSON.stringify(normalized, null, 2));
        if (normalized.id) {
          setSelectedModelId(normalized.id);
        }
      }
    } catch (err) {
      setError(err?.message || 'Failed to load template');
    } finally {
      setLoading(false);
    }
  }, [normalizeModel, hydrateEditable]);

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const resp = await apiFetch(buildApiUrl('/models'));
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Failed to load models (${resp.status})`);
      }
      const data = await resp.json();
      const list = Array.isArray(data?.models) ? data.models.map(normalizeModel) : [];
      setModels(list);
    } catch (err) {
      setModelsError(err?.message || 'Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  }, [normalizeModel]);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (!models || models.length === 0 || selectedModelId) return;

    const matchById = template?.id ? models.find((m) => m.id === template.id) : null;
    const fallbackName = template?.name || 'Default';
    const fallback = matchById || models.find((m) => m.name === fallbackName) || models[0] || null;
    if (fallback) {
      setSelectedModelId(fallback.id || null);
      const normalized = normalizeModel(fallback);
      setTemplate(normalized);
      if (normalized) {
        hydrateEditable(normalized);
        setJsonText(JSON.stringify(normalized, null, 2));
      }
    }
  }, [models, selectedModelId, template, normalizeModel, hydrateEditable]);

  const handleSave = async () => {
    setError('');
    setSaveMessage('');

    const base = { ...(template || {}) };
    const payload = {};

    Object.keys(base).forEach((key) => {
      if (key === 'id' || key === 'createdAt' || key === 'updatedAt') return;
      payload[key] = base[key];
    });

    for (const field of EDITABLE_FIELDS) {
      const raw = editableModel[field.key];
      if (field.type === 'number') {
        if (raw === '' || raw === null || raw === undefined) {
          payload[field.key] = null;
          continue;
        }
        const num = Number(raw);
        if (!Number.isFinite(num)) {
          setError(`Field "${field.label}" must be a number.`);
          return;
        }
        payload[field.key] = num;
      } else {
        payload[field.key] = raw || '';
      }
    }

    if (!payload.name || typeof payload.name !== 'string') {
      setError('Model name is required.');
      return;
    }

    delete payload.id;
    setJsonText(JSON.stringify(payload, null, 2));

    setSaving(true);
    try {
      const resp = await apiFetch(buildApiUrl('/models'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      const detail = Array.isArray(data?.details)
        ? data.details.join('; ')
        : data?.details;
      if (!resp.ok) {
        throw new Error(detail || data?.error || 'Failed to save model');
      }
      const normalized = normalizeModel(data);
      if (normalized) {
        setTemplate(normalized);
        hydrateEditable(normalized);
        setJsonText(JSON.stringify(normalized, null, 2));
        setSelectedModelId(normalized.id || null);
      }
      setSaveMessage(`Saved model "${data.name}". It will appear in the chooser.`);
      fetchModels();
    } catch (err) {
      setError(err?.message || 'Failed to save model');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedModelId) {
      setError('No model selected to delete.');
      return;
    }
    if (template?.name === 'Default') {
      setError('The Default model cannot be deleted.');
      return;
    }
    setError('');
    setSaveMessage('');
    setDeleting(true);
    try {
      const resp = await apiFetch(buildApiUrl(`/models/${selectedModelId}`), { method: 'DELETE' });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || 'Failed to delete model');
      }
      setSaveMessage(`Deleted model "${template?.name || selectedModelId}".`);
      setSelectedModelId(null);
      setTemplate(null);
      setEditableModel({});
      setJsonText('');
      await fetchModels();
      await fetchTemplate();
    } catch (err) {
      setError(err?.message || 'Failed to delete model');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.headerBg} />

      {/* Back Button */}
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
      >
        <Text style={styles.backButtonText}>←</Text>
      </Pressable>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Model Editor</Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Text style={styles.lead}>Download the default model, adjust parameters or equations, and save as a new model.</Text>

        <View style={styles.selectorCard}>
          <Text style={styles.label}>Active model</Text>
          <Pressable
            style={styles.dropdownToggle}
            onPress={() => setPickerOpen((prev) => !prev)}
            disabled={modelsLoading}
          >
            <Text style={styles.dropdownToggleText}>
              {template?.name || 'Choose model'}
            </Text>
            <Text style={styles.dropdownCaret}>{pickerOpen ? '^' : 'v'}</Text>
          </Pressable>
          {modelsError ? <Text style={styles.error}>{modelsError}</Text> : null}
          {pickerOpen && (
            <View style={styles.dropdownPanel}>
              <Pressable style={styles.dropdownRefresh} onPress={fetchModels} disabled={modelsLoading}>
                <Text style={styles.dropdownRefreshText}>{modelsLoading ? 'Refreshing…' : 'Refresh list'}</Text>
              </Pressable>
              {modelsLoading ? (
                <View style={styles.dropdownLoadingRow}>
                  <ActivityIndicator size="small" color={COLORS.accent} />
                  <Text style={styles.dropdownEmptyText}>Loading models…</Text>
                </View>
              ) : models.length === 0 ? (
                <Text style={styles.dropdownEmptyText}>No models found</Text>
              ) : (
                models.map((model, idx) => (
                  <Pressable
                    key={model.id || model.name || idx}
                    style={[
                      styles.dropdownItem,
                      idx === models.length - 1 && styles.dropdownItemLast,
                      selectedModelId === model.id && styles.dropdownItemActive,
                    ]}
                    onPress={() => {
                      const normalized = normalizeModel(model);
                      setTemplate(normalized);
                      hydrateEditable(normalized);
                      setJsonText(JSON.stringify(normalized, null, 2));
                      setSelectedModelId(normalized?.id || null);
                      setPickerOpen(false);
                      setSaveMessage('');
                      setError('');
                    }}
                  >
                    <Text style={styles.dropdownItemTitle}>{model.name}</Text>
                    {model.description ? (
                      <Text style={styles.dropdownItemDescription}>{model.description}</Text>
                    ) : null}
                    {selectedModelId === model.id ? (
                      <Text style={styles.selectedModelTag}>Selected</Text>
                    ) : null}
                  </Pressable>
                ))
              )}
            </View>
          )}
        </View>

        <View style={styles.rowButtons}>
          <Pressable style={styles.primaryButton} onPress={fetchTemplate} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? 'Loading…' : 'Download default'}</Text>
          </Pressable>
          <Pressable style={[styles.secondaryButton, saving && styles.disabled]} onPress={handleSave} disabled={saving}>
            <Text style={styles.secondaryButtonText}>{saving ? 'Saving…' : 'Save as new model'}</Text>
          </Pressable>
          {selectedModelId && template?.name !== 'Default' && (
            <Pressable
              style={[styles.deleteButton, deleting && styles.disabled]}
              onPress={handleDelete}
              disabled={deleting}
            >
              <Text style={styles.deleteButtonText}>{deleting ? 'Deleting…' : 'Delete model'}</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.formGrid}>
          {EDITABLE_FIELDS.map((field) => (
            <View key={field.key} style={styles.formField}>
              <Text style={styles.label}>{field.label}</Text>
              <TextInput
                style={styles.editInput}
                value={editableModel[field.key] ?? ''}
                onChangeText={(text) => {
                  setEditableModel((prev) => ({ ...prev, [field.key]: text }));
                  setSaveMessage('');
                }}
                keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                placeholder={field.type === 'number' ? 'Enter number' : 'Enter text'}
                placeholderTextColor={COLORS.textLight}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ))}
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
          editable={false}
          selectTextOnFocus
          placeholder="Model JSON will appear here"
          placeholderTextColor={COLORS.textLight}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.equationsCard}>
          <Text style={styles.label}>Default equations preview</Text>
          {Array.isArray(template?.equations) && template.equations.length ? (
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
    backgroundColor: COLORS.headerBg,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 50 : 45,
    paddingBottom: 10,
    paddingHorizontal: 60,
    alignItems: 'center',
    backgroundColor: COLORS.headerBg,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    position: 'absolute',
    top: 70,
    left: 20,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: COLORS.backBtnBg,
    borderWidth: 2,
    borderColor: COLORS.backBtnBorder,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  backButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: 20,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.headerText,
    textAlign: 'center',
  },
  body: {
    flex: 1,
    backgroundColor: COLORS.background,
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
  deleteButton: {
    backgroundColor: '#B24636',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8B2E23',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  formField: {
    width: '100%',
  },
  editInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: COLORS.text,
    fontSize: 14,
  },
  selectorCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.inputBg,
    padding: 12,
    gap: 8,
  },
  dropdownToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
  },
  dropdownToggleText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  dropdownCaret: {
    color: COLORS.textLight,
    fontSize: 14,
    marginLeft: 8,
  },
  dropdownPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
  },
  dropdownRefresh: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  dropdownRefreshText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },
  dropdownLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownEmptyText: {
    color: COLORS.textLight,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  dropdownItemLast: {
    borderBottomWidth: 0,
  },
  dropdownItemActive: {
    backgroundColor: '#EFE9DF',
  },
  dropdownItemTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  dropdownItemDescription: {
    color: COLORS.textLight,
    fontSize: 12,
    marginTop: 2,
  },
  selectedModelTag: {
    marginTop: 6,
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
});

export default ModelEditorScreen;
