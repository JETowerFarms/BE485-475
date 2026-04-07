import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Pressable,
  Animated,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildApiUrl, apiFetch } from '../config/apiConfig';

import { COLORS } from '../styles/theme';
import {
  calculatePolygonArea,
  computeCentroidLatLng,
  validateCoordinates,
} from '../utils/geometryUtils';

import useCropOptions from '../hooks/useCropOptions';
import useIncentiveCatalog from '../hooks/useIncentiveCatalog';
import useFarmAnalysis from '../hooks/useFarmAnalysis';

import FarmDrawer from '../components/FarmDrawer';
import ExpandedTileModal from '../components/ExpandedTileModal';
import ModelPickerModal from '../components/ModelPickerModal';
import ConfigModal from '../components/ConfigModal';
import CropEditorModal from '../components/CropEditorModal';
import CropRotationSelector from '../components/CropRotationSelector';
import PvSystemInputs from '../components/PvSystemInputs';
import IncentivePicker from '../components/IncentivePicker';

// Dev-only: probe external connectivity for map / satellite assets.
const runNetworkProbe = async () => {
  const leafletUrl = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const esriTileUrl =
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0';
  try {
    const res = await fetch(leafletUrl, { method: 'GET' });
    console.log('[NetProbe] Leaflet fetch:', res.status, res.ok);
  } catch (e) {
    console.error('[NetProbe] Leaflet fetch failed:', e?.message || e);
  }
  try {
    const ok = await Image.prefetch(esriTileUrl);
    console.log('[NetProbe] ESRI tile prefetch:', ok);
  } catch (e) {
    console.error('[NetProbe] ESRI tile prefetch failed:', e?.message || e);
  }
};

const emptyPvInputs = {
  kwPerAcre: '200',
  tilt: '35',
  azimuth: '180',
  arrayType: '0',
  moduleType: '0',
  losses: '16',
};

// Slim orchestrator — UI logic lives in /components and /hooks.
const FarmDescriptionScreen = ({
  farms,
  county,
  city,
  onNavigateBack,
  onNavigateNext,
  onFarmsUpdate,
  onOpenModelEditor,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [horizontalIndex, setHorizontalIndex] = useState(0);

  const [expandedModalVisible, setExpandedModalVisible] = useState(false);
  const [expandedViewType, setExpandedViewType] = useState(null);
  const [expandedFarmIndex, setExpandedFarmIndex] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);

  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [cropEditorVisible, setCropEditorVisible] = useState(false);

  const [selectedFarmIds, setSelectedFarmIds] = useState([]);
  const [farmDropdownOpen, setFarmDropdownOpen] = useState(false);
  const [siteIncludes, setSiteIncludes] = useState(''); // 'farming' | 'grazing' | 'neither'

  const [rotationFarmId, setRotationFarmId] = useState(null);
  const [rotationByFarmId, setRotationByFarmId] = useState({});
  const [rotationDraftByFarmId, setRotationDraftByFarmId] = useState({});

  const [pvFarmId, setPvFarmId] = useState(null);
  const [pvInputsByFarmId, setPvInputsByFarmId] = useState({});
  const [pvDraftByFarmId, setPvDraftByFarmId] = useState({});

  const [selectedModelId, setSelectedModelId] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);

  const [selectedIncentiveIds, setSelectedIncentiveIds] = useState([]);
  const [incentiveParams, setIncentiveParams] = useState({
    brownfield_egle_amount: 500000,
  });

  const [submitError, setSubmitError] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);

  useEffect(() => {
    if (!__DEV__) return;
    setTimeout(() => runNetworkProbe(), 0);
  }, []);

  const { cropOptions, setCropOptions, cropOptionsLoading, cropOptionsError } =
    useCropOptions();

  const handleDefaultIncentiveIds = useCallback((ids) => {
    setSelectedIncentiveIds(ids);
  }, []);

  const { incentiveCatalog, incentivesLoading, incentivesError } =
    useIncentiveCatalog(handleDefaultIncentiveIds);

  const { refreshFarmAnalysis } = useFarmAnalysis(
    farms,
    onFarmsUpdate,
    setModalLoading,
  );

  const builtFarms = useMemo(() => {
    if (!farms || farms.length === 0) return [];
    const filtered = farms.filter((f) => {
      const pinLen =
        (f.pins && f.pins.length) ||
        (f.properties && f.properties.pinCount) ||
        0;
      return pinLen > 0;
    });
    const seen = new Set();
    return filtered.filter((f) => {
      if (!f || !f.id) return false;
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
  }, [farms]);

  useEffect(() => {
    if (builtFarms.length === 0) {
      setCurrentIndex(0);
    } else if (currentIndex >= builtFarms.length) {
      setCurrentIndex(builtFarms.length - 1);
    }
  }, [builtFarms.length]);

  useEffect(() => {
    if (selectedFarmIds.length === 0) {
      setRotationFarmId(null);
      setPvFarmId(null);
      return;
    }
    if (!rotationFarmId || !selectedFarmIds.includes(rotationFarmId)) {
      setRotationFarmId(selectedFarmIds[0]);
    }
    if (!pvFarmId || !selectedFarmIds.includes(pvFarmId)) {
      setPvFarmId(selectedFarmIds[0]);
    }
  }, [selectedFarmIds, rotationFarmId, pvFarmId]);

  useEffect(() => {
    if (!rotationFarmId) return;
    setRotationDraftByFarmId((prev) => {
      if (prev[rotationFarmId]) return prev;
      const saved = rotationByFarmId?.[rotationFarmId];
      return {
        ...prev,
        [rotationFarmId]: {
          cropIds: Array.isArray(saved?.cropIds) ? saved.cropIds : [],
        },
      };
    });
  }, [rotationFarmId, rotationByFarmId]);

  useEffect(() => {
    if (!pvFarmId) return;
    setPvDraftByFarmId((prev) => {
      if (prev[pvFarmId]) return prev;
      const saved = pvInputsByFarmId?.[pvFarmId];
      return {
        ...prev,
        [pvFarmId]: { ...(saved || emptyPvInputs) },
      };
    });
  }, [pvFarmId, pvInputsByFarmId]);

  const getFarmLabel = useCallback(
    (farmId) => {
      const farm = builtFarms.find((f) => f?.id === farmId);
      return (
        farm?.properties?.name ||
        (farm ? `Farm ${builtFarms.indexOf(farm) + 1}` : 'Farm')
      );
    },
    [builtFarms],
  );

  const rotationDraftCropIds = useMemo(() => {
    const draft = rotationFarmId
      ? rotationDraftByFarmId?.[rotationFarmId]
      : null;
    return Array.isArray(draft?.cropIds) ? draft.cropIds : [];
  }, [rotationFarmId, rotationDraftByFarmId]);

  const pvDraftInputs = useMemo(() => {
    const draft = pvFarmId ? pvDraftByFarmId?.[pvFarmId] : null;
    return draft || emptyPvInputs;
  }, [pvFarmId, pvDraftByFarmId]);

  const isFormValid =
    selectedFarmIds.length > 0 && siteIncludes === 'farming';

  const toggleFarmSelection = (farmId) => {
    setSelectedFarmIds((prev) =>
      prev.includes(farmId)
        ? prev.filter((id) => id !== farmId)
        : [...prev, farmId],
    );
  };

  const toggleRotationCrop = useCallback(
    (cropId) => {
      if (!rotationFarmId) return;
      setRotationDraftByFarmId((prev) => {
        const current = prev?.[rotationFarmId];
        const existingIds = Array.isArray(current?.cropIds)
          ? current.cropIds
          : [];
        const nextIds = existingIds.includes(cropId)
          ? existingIds.filter((id) => id !== cropId)
          : [...existingIds, cropId];
        return { ...prev, [rotationFarmId]: { cropIds: nextIds } };
      });
    },
    [rotationFarmId],
  );

  const setNoRotationForFarm = useCallback(() => {
    if (!rotationFarmId) return;
    setRotationDraftByFarmId((prev) => ({
      ...prev,
      [rotationFarmId]: { cropIds: [] },
    }));
  }, [rotationFarmId]);

  const saveRotationForCurrentFarm = useCallback(() => {
    if (!rotationFarmId) return;
    setRotationByFarmId((prev) => ({
      ...prev,
      [rotationFarmId]: { cropIds: rotationDraftCropIds },
    }));
  }, [rotationFarmId, rotationDraftCropIds]);

  const removeCropFromRotations = useCallback((cropId) => {
    const filter = (prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([fid, data]) => {
        const ids = Array.isArray(data?.cropIds)
          ? data.cropIds.filter((id) => id !== cropId)
          : [];
        next[fid] = { cropIds: ids };
      });
      return next;
    };
    setRotationDraftByFarmId(filter);
    setRotationByFarmId(filter);
  }, []);

  const setPvDraftField = useCallback(
    (field, value) => {
      if (!pvFarmId) return;
      setPvDraftByFarmId((prev) => ({
        ...prev,
        [pvFarmId]: { ...(prev[pvFarmId] || emptyPvInputs), [field]: value },
      }));
    },
    [pvFarmId],
  );

  const savePvForCurrentFarm = useCallback(() => {
    if (!pvFarmId) return;
    setPvInputsByFarmId((prev) => ({
      ...prev,
      [pvFarmId]: { ...(pvDraftByFarmId?.[pvFarmId] || emptyPvInputs) },
    }));
  }, [pvFarmId, pvDraftByFarmId]);

  const toggleIncentive = useCallback(
    (id) =>
      setSelectedIncentiveIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      ),
    [],
  );

  const handleIncentiveParamChange = useCallback((key, value) => {
    setIncentiveParams((p) => ({ ...p, [key]: value }));
  }, []);

  const buildConfigSnapshot = useCallback(
    () => ({
      selectedFarmIds,
      siteIncludes,
      rotationByFarmId,
      rotationDraftByFarmId,
      pvInputsByFarmId,
      pvDraftByFarmId,
      pvFarmId,
      selectedModelId,
    }),
    [
      selectedFarmIds,
      siteIncludes,
      rotationByFarmId,
      rotationDraftByFarmId,
      pvInputsByFarmId,
      pvDraftByFarmId,
      pvFarmId,
      selectedModelId,
    ],
  );

  const applyConfigSnapshot = useCallback((snap) => {
    setSelectedFarmIds(
      Array.isArray(snap?.selectedFarmIds) ? snap.selectedFarmIds : [],
    );
    setSiteIncludes(snap?.siteIncludes || '');
    setRotationByFarmId(snap?.rotationByFarmId || {});
    setRotationDraftByFarmId(snap?.rotationDraftByFarmId || {});
    setPvInputsByFarmId(snap?.pvInputsByFarmId || {});
    setPvDraftByFarmId(snap?.pvDraftByFarmId || {});
    setPvFarmId(
      snap?.pvFarmId ||
        (Array.isArray(snap?.selectedFarmIds)
          ? snap.selectedFarmIds[0]
          : null),
    );
    setSelectedModelId(snap?.selectedModelId || null);
  }, []);

  const toggleDrawer = useCallback(() => {
    const toValue = drawerOpen ? 0 : 1;
    Animated.timing(drawerAnim, {
      toValue,
      duration: 300,
      useNativeDriver: true,
    }).start();
    setDrawerOpen((prev) => !prev);
  }, [drawerOpen, drawerAnim]);

  const handleTilePress = useCallback((viewType, farmIndex) => {
    setModalLoading(true);
    setExpandedViewType(viewType);
    setExpandedFarmIndex(farmIndex);
    setExpandedModalVisible(true);
    setTimeout(() => setModalLoading(false), 100);
  }, []);

  const handleNext = async () => {
    setSubmitError('');

    // Merge draft state into effective state for submit
    const effectiveRotationsByFarmId = { ...rotationByFarmId };
    selectedFarmIds.forEach((farmId) => {
      const draft = rotationDraftByFarmId?.[farmId];
      if (!draft) return;
      const cropIds = Array.isArray(draft.cropIds) ? draft.cropIds : [];
      effectiveRotationsByFarmId[farmId] = { cropIds };
    });

    const effectivePvByFarmId = { ...pvInputsByFarmId };
    selectedFarmIds.forEach((farmId) => {
      const draft = pvDraftByFarmId?.[farmId];
      if (!draft) return;
      effectivePvByFarmId[farmId] = { ...draft };
    });

    if (!selectedFarmIds.length) {
      setSubmitError('Select at least one farm.');
      return;
    }
    if (siteIncludes !== 'farming') {
      setSubmitError('Select "Farming" to provide PV system inputs.');
      return;
    }

    const selectedFarms = builtFarms.filter((f) =>
      selectedFarmIds.includes(f.id),
    );
    if (!selectedFarms.length) {
      setSubmitError('Selected farms are missing.');
      return;
    }

    const cropIdToName = new Map(
      (cropOptions || []).map((c) => [
        c?.id ?? c?.crop_id ?? c?.name ?? c?.crop,
        c?.name || c?.crop || '',
      ]),
    );

    setSubmitLoading(true);
    let updatedFarms = [...(farms || [])];

    try {
      for (const farm of selectedFarms) {
        const rawCoordinates = farm?.geometry?.coordinates?.[0] || [];
        const coordinates =
          rawCoordinates.length > 1 &&
          rawCoordinates[0][0] ===
            rawCoordinates[rawCoordinates.length - 1][0] &&
          rawCoordinates[0][1] ===
            rawCoordinates[rawCoordinates.length - 1][1]
            ? rawCoordinates.slice(0, -1)
            : rawCoordinates;

        validateCoordinates(coordinates);

        const area = calculatePolygonArea(coordinates).acres;
        const centroid = computeCentroidLatLng(coordinates);
        if (!area || area <= 0) {
          throw new Error(
            `Unable to compute area for ${getFarmLabel(farm.id)}.`,
          );
        }

        const pv = effectivePvByFarmId[farm.id];
        if (!pv) {
          throw new Error(`Enter PV inputs for ${getFarmLabel(farm.id)}.`);
        }

        const parsedKwPerAcre = Number(pv.kwPerAcre);
        const parsedTilt = Number(pv.tilt);
        const parsedAzimuth = Number(pv.azimuth);
        const parsedArrayType = Number(pv.arrayType);
        const parsedModuleType = Number(pv.moduleType);
        const parsedLosses = Number(pv.losses);

        if (
          !Number.isFinite(parsedKwPerAcre) ||
          !Number.isFinite(parsedTilt) ||
          !Number.isFinite(parsedAzimuth) ||
          !Number.isFinite(parsedArrayType) ||
          !Number.isFinite(parsedModuleType) ||
          !Number.isFinite(parsedLosses)
        ) {
          throw new Error(
            `All PV parameters must be numbers for ${getFarmLabel(farm.id)}.`,
          );
        }

        const cropIds = Array.isArray(
          effectiveRotationsByFarmId?.[farm.id]?.cropIds,
        )
          ? effectiveRotationsByFarmId[farm.id].cropIds
          : [];

        const cropNames = cropIds
          .map((id) => cropIdToName.get(id) || '')
          .filter((name) => name.trim().length > 0);

        if (cropNames.length === 0) {
          throw new Error(
            `Select at least one crop for ${getFarmLabel(farm.id)}.`,
          );
        }

        const systemCapacity = area * parsedKwPerAcre;
        if (!Number.isFinite(systemCapacity) || systemCapacity <= 0) {
          throw new Error(
            `System capacity must be positive for ${getFarmLabel(farm.id)}.`,
          );
        }

        const payload = {
          farmId: farm.id,
          geometry: farm.geometry,
          acres: area,
          crops: cropNames,
          pvwatts: {
            lat: centroid.lat,
            lon: centroid.lon,
            system_capacity: systemCapacity,
            module_type: parsedModuleType,
            array_type: parsedArrayType,
            tilt: parsedTilt,
            azimuth: parsedAzimuth,
            losses: parsedLosses,
          },
          modelId: selectedModel?.id || null,
          modelFlags: {
            ...(selectedIncentiveIds.length > 0
              ? { eligible_incentives: selectedIncentiveIds }
              : {}),
            ...(selectedIncentiveIds.includes('brownfield_egle')
              ? {
                  incentive_params: {
                    brownfield_egle_amount:
                      incentiveParams.brownfield_egle_amount,
                  },
                }
              : {}),
          },
        };

        const response = await apiFetch(
          buildApiUrl('/linear-optimization'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );

        const text = await response.text();
        if (!response.ok) {
          throw new Error(
            text ||
              `Request failed (${response.status}) for ${getFarmLabel(farm.id)}`,
          );
        }
        const data = JSON.parse(text || '{}');

        updatedFarms = updatedFarms.map((f) => {
          if (f?.id !== payload.farmId) return f;
          return {
            ...f,
            linearOptimization: data.optimization || null,
            linearOptimizationLogs: data.logs || null,
          };
        });
      }

      if (onFarmsUpdate) onFarmsUpdate(updatedFarms);
      if (onNavigateNext) onNavigateNext(updatedFarms);
    } catch (err) {
      setSubmitError(err?.message || 'Failed to run optimization');
    } finally {
      setSubmitLoading(false);
    }
  };

  const expandedFarm =
    expandedFarmIndex !== null ? builtFarms[expandedFarmIndex] ?? null : null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.headerBg} />

      <Pressable
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.backButtonPressed,
        ]}
        onPress={onNavigateBack}
      >
        <Text style={styles.backButtonText}>←</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Define Your Solar Site</Text>
      </View>

      <KeyboardAvoidingView style={styles.formContainer} behavior="padding">
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          persistentScrollbar
        >
          <Pressable
            style={styles.rotationSaveButton}
            onPress={() => setModelPickerVisible(true)}
          >
            <Text style={styles.rotationSaveButtonText}>
              {`Choose model: ${selectedModel?.name || 'Default'}`}
            </Text>
          </Pressable>

          <Pressable style={styles.rotationSaveButton} onPress={onOpenModelEditor}>
            <Text style={styles.rotationSaveButtonText}>Open model editor</Text>
          </Pressable>

          <Pressable
            style={styles.rotationSaveButton}
            onPress={() => setConfigModalVisible(true)}
          >
            <Text style={styles.rotationSaveButtonText}>
              Save / Load configuration
            </Text>
          </Pressable>

          <View style={[styles.selectorCard, { marginTop: 16 }]}>
            <Text style={styles.label}>Select Farm(s) *</Text>
            <Pressable
              style={styles.dropdownButton}
              onPress={() => setFarmDropdownOpen((v) => !v)}
            >
              <Text style={styles.dropdownButtonText}>
                {selectedFarmIds.length === 0
                  ? 'Select farms...'
                  : `${selectedFarmIds.length} farm${selectedFarmIds.length > 1 ? 's' : ''} selected`}
              </Text>
              <Text style={styles.dropdownArrow}>
                {farmDropdownOpen ? '^' : 'v'}
              </Text>
            </Pressable>

            {farmDropdownOpen && (
              <ScrollView style={styles.dropdownList} nestedScrollEnabled>
                {builtFarms.length === 0 ? (
                  <Text style={styles.dropdownEmptyText}>
                    No farms built yet
                  </Text>
                ) : (
                  builtFarms.map((farm) => (
                    <Pressable
                      key={farm.id}
                      style={styles.dropdownItem}
                      onPress={() => toggleFarmSelection(farm.id)}
                    >
                      <View style={styles.checkbox}>
                        {selectedFarmIds.includes(farm.id) && (
                          <Text style={styles.checkmark}>✓</Text>
                        )}
                      </View>
                      <Text style={styles.dropdownItemText}>
                        {farm.properties?.name ||
                          `Farm ${builtFarms.indexOf(farm) + 1}`}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Will your site include: *</Text>
            <View style={styles.checkboxGroup}>
              {['farming', 'grazing', 'neither'].map((opt) => (
                <Pressable
                  key={opt}
                  style={styles.checkboxOption}
                  onPress={() => setSiteIncludes(opt)}
                >
                  <View style={styles.checkbox}>
                    {siteIncludes === opt && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </View>
                  <Text style={styles.checkboxLabel}>
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {siteIncludes === 'farming' && (
            <>
              <CropRotationSelector
                selectedFarmIds={selectedFarmIds}
                getFarmLabel={getFarmLabel}
                cropOptions={cropOptions}
                cropOptionsLoading={cropOptionsLoading}
                cropOptionsError={cropOptionsError}
                rotationFarmId={rotationFarmId}
                onRotationFarmChange={setRotationFarmId}
                rotationDraftCropIds={rotationDraftCropIds}
                onToggleCrop={toggleRotationCrop}
                onNoRotation={setNoRotationForFarm}
                onOpenCropEditor={() => setCropEditorVisible(true)}
              />

              <PvSystemInputs
                selectedFarmIds={selectedFarmIds}
                getFarmLabel={getFarmLabel}
                pvFarmId={pvFarmId}
                onPvFarmChange={setPvFarmId}
                pvDraftInputs={pvDraftInputs}
                onFieldChange={setPvDraftField}
                onSave={savePvForCurrentFarm}
              />

              <IncentivePicker
                incentiveCatalog={incentiveCatalog}
                incentivesLoading={incentivesLoading}
                incentivesError={incentivesError}
                selectedIncentiveIds={selectedIncentiveIds}
                onToggle={toggleIncentive}
                onSelectAll={() =>
                  setSelectedIncentiveIds(incentiveCatalog.map((i) => i.id))
                }
                onClearAll={() => setSelectedIncentiveIds([])}
                incentiveParams={incentiveParams}
                onIncentiveParamChange={handleIncentiveParamChange}
              />
            </>
          )}

          {(siteIncludes === 'grazing' || siteIncludes === 'neither') && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>future direction</Text>
            </View>
          )}

          {siteIncludes !== '' && (
            <Text style={styles.requiredText}>* Required fields</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.controlPanel}>
        {submitError ? (
          <Text style={styles.errorText}>{submitError}</Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.nextButton,
            (!isFormValid || submitLoading) && styles.nextButtonDisabled,
            pressed && isFormValid && !submitLoading && styles.nextButtonPressed,
          ]}
          onPress={handleNext}
          disabled={!isFormValid || submitLoading}
        >
          <Text
            style={[
              styles.nextButtonText,
              (!isFormValid || submitLoading) && styles.nextButtonTextDisabled,
            ]}
          >
            {submitLoading ? 'Running…' : 'Next'}
          </Text>
        </Pressable>
      </View>

      <FarmDrawer
        open={drawerOpen}
        onToggle={toggleDrawer}
        drawerAnim={drawerAnim}
        builtFarms={builtFarms}
        currentIndex={currentIndex}
        onIndexChange={setCurrentIndex}
        horizontalIndex={horizontalIndex}
        onHorizontalIndexChange={setHorizontalIndex}
        onTilePress={handleTilePress}
      />

      <ExpandedTileModal
        visible={expandedModalVisible}
        onClose={() => setExpandedModalVisible(false)}
        viewType={expandedViewType}
        farm={expandedFarm}
        farmIndex={expandedFarmIndex}
        loading={modalLoading}
        onRefresh={refreshFarmAnalysis}
      />

      <ModelPickerModal
        visible={modelPickerVisible}
        onClose={() => setModelPickerVisible(false)}
        selectedModelId={selectedModelId}
        onSelect={(model) => {
          setSelectedModel(model);
          setSelectedModelId(model?.id ?? null);
          setModelPickerVisible(false);
        }}
      />

      <ConfigModal
        visible={configModalVisible}
        onClose={() => setConfigModalVisible(false)}
        buildSnapshot={buildConfigSnapshot}
        onLoad={applyConfigSnapshot}
      />

      <CropEditorModal
        visible={cropEditorVisible}
        onClose={() => setCropEditorVisible(false)}
        cropOptions={cropOptions}
        onSaved={(updatedCrop) => {
          setCropOptions((prev) => {
            const filtered = prev.filter((c) => c?.id !== updatedCrop?.id);
            const next = [...filtered, updatedCrop];
            next.sort((a, b) =>
              String(a?.name || a?.crop || '').localeCompare(
                String(b?.name || b?.crop || ''),
              ),
            );
            return next;
          });
        }}
        onDeleted={(cropId) => {
          setCropOptions((prev) => prev.filter((c) => c?.id !== cropId));
          removeCropFromRotations(cropId);
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 55 : 12,
    left: 15,
    zIndex: 100,
    width: 40,
    height: 40,
    backgroundColor: COLORS.backBtnBg,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: COLORS.backBtnBorder,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  backButtonPressed: { opacity: 0.7 },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  header: {
    backgroundColor: COLORS.headerBg,
    paddingVertical: 15,
    paddingHorizontal: 60,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.headerBorder,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.headerText,
  },
  formContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 80,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  inputGroup: {
    marginBottom: 16,
  },
  selectorCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  checkboxGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  checkboxOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderRadius: 4,
    backgroundColor: COLORS.inputBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 15,
    color: COLORS.text,
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownButtonDisabled: {
    opacity: 0.5,
  },
  dropdownButtonText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  dropdownArrow: {
    fontSize: 12,
    color: COLORS.textLight,
    marginLeft: 8,
  },
  dropdownList: {
    maxHeight: 200,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    marginTop: 4,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    gap: 10,
  },
  dropdownItemText: {
    fontSize: 14,
    color: COLORS.text,
  },
  dropdownEmptyText: {
    fontSize: 13,
    color: COLORS.textLight,
    padding: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  rotationSaveButton: {
    backgroundColor: COLORS.buttonBg,
    borderWidth: 1,
    borderColor: COLORS.buttonBorder,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  rotationSaveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.buttonText,
  },
  requiredText: {
    fontSize: 12,
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginTop: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#C54B4B',
    marginBottom: 6,
    textAlign: 'center',
  },
  controlPanel: {
    backgroundColor: COLORS.headerBg,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderTopWidth: 2,
    borderTopColor: COLORS.headerBorder,
    alignItems: 'center',
    gap: 8,
  },
  nextButton: {
    backgroundColor: COLORS.nextButtonBg,
    borderWidth: 2,
    borderColor: COLORS.nextButtonBorder,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 40,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  nextButtonDisabled: {
    backgroundColor: '#E0D8CC',
    borderColor: '#B0A898',
    shadowOpacity: 0.15,
    elevation: 2,
  },
  nextButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  nextButtonText: {
    color: COLORS.buttonText,
    fontSize: 18,
    fontWeight: 'bold',
  },
  nextButtonTextDisabled: {
    color: '#999999',
  },
});

export default FarmDescriptionScreen;
