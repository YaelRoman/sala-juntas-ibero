/* ============================================================
   RECURRING.JS — Lógica de reservaciones recurrentes
   HU-27: Crear reservación recurrente
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const Recurring = (() => {

  const MAX_INSTANCES = 52;

  /* ════════════════════════════════════════
     GENERATE — calcula las instancias
     ════════════════════════════════════════ */
  /**
   * @param {object} opts
   * @param {string} opts.date
   * @param {string} opts.startTime
   * @param {string} opts.endTime
   * @param {string} opts.responsible
   * @param {string} opts.area
   * @param {string} [opts.observations]
   * @param {'daily'|'weekly'|'biweekly'|'monthly'} opts.frequency
   * @param {number} opts.count
   * @param {string} [opts.endDate]
   * @returns {{ group, instances, skipped }}
   */
  const generate = (opts) => {
    const {
      date, startTime, endTime, responsible_id, area, observations = '',
      frequency, count, endDate,
    } = opts;

    const groupId = Utils.uid();
    const group = {
      id:             groupId,
      pattern:        frequency,
      endDate:        endDate || null,
      maxOccurrences: count,
      createdAt:      new Date().toISOString(),
    };

    const holidaySet = new Set(Store.getState().holidays.map(h => h.date));
    const userId     = Store.getUser()?.id ?? 'unknown';
    const maxCount   = Math.min(count, MAX_INSTANCES);

    const instances = [];
    const skipped   = [];

    let current   = _toDate(date);
    let generated = 0;
    let iters     = 0;
    const iterLimit = maxCount * 4;

    while (generated < maxCount && iters < iterLimit) {
      iters++;
      const dateStr = Utils.dateToISO(current);

      if (endDate && dateStr > endDate) break;

      const dow = current.getDay();
      if (dow === 0 || dow === 6) {
        skipped.push({ date: dateStr, reason: 'weekend' });
        _advance(current, frequency);
        continue;
      }

      if (holidaySet.has(dateStr)) {
        skipped.push({ date: dateStr, reason: 'holiday' });
        _advance(current, frequency);
        continue;
      }

      const conflict = Reservations.checkOverlap(dateStr, startTime, endTime);
      if (conflict) {
        skipped.push({ date: dateStr, reason: 'overlap', conflictWith: conflict });
        _advance(current, frequency);
        continue;
      }

      instances.push({
        id:               Utils.uid(),
        responsible_id,
        area:             area.trim(),
        date:             dateStr,
        startTime,
        endTime,
        observations:     observations.trim(),
        status:           'active',
        isRecurring:      true,
        recurringGroupId: groupId,
        createdBy:        userId,
        createdAt:        new Date().toISOString(),
      });

      generated++;
      _advance(current, frequency);
    }

    return { group, instances, skipped };
  };

  /* ════════════════════════════════════════
     SAVE — persiste grupo e instancias
     ════════════════════════════════════════ */
  const save = async ({ group, instances }) => {
    if (!instances.length) return 0;

    const state = Store.getState();
    Store.setState({ recurringGroups: [...state.recurringGroups, group] });

    // Create recurring group in DB first and get the actual group ID
    let actualGroupId = group.id;
    console.log('Recurring.save: Initial group.id:', group.id);

    // Validate UUID pattern (8-4-4-4-12 hex digits)
    const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

    try {
      const createdGroup = await API.createRecurringGroup({
        pattern: group.pattern,
        endDate: group.endDate,
        maxOccurrences: group.maxOccurrences
      });
      console.log('Recurring.save: createdGroup response:', createdGroup);

      // Validate the returned ID is a proper UUID
      if (createdGroup && createdGroup.id && isUUID(createdGroup.id)) {
        actualGroupId = createdGroup.id;
        console.log('Recurring.save: Set actualGroupId to valid UUID:', actualGroupId);
      } else {
        console.warn('Recurring.save: Invalid group ID from API:', createdGroup?.id);
        throw new Error('Invalid group ID from API: ' + createdGroup?.id);
      }
    } catch (err) {
      console.error('Error creating recurring group:', err);
      throw err;
    }

    // Save each instance to the API
    let savedCount = 0;
    const savedInstances = [];
    for (const r of instances) {
      try {
        const apiData = {
          responsible_id: r.responsible_id,
          area: r.area,
          start_time: `${r.date}T${r.startTime}:00`,
          end_time: `${r.date}T${r.endTime}:00`,
          observations: r.observations,
          is_recurring: true,
          recurring_group: actualGroupId,
        };
        console.log('Recurring.save: Creating instance with actualGroupId:', actualGroupId);
        const apiResponse = await API.createReservation(apiData);
        // Add the API response (properly normalized) to Store
        if (apiResponse) {
          Store.addReservation(apiResponse);
          savedInstances.push(apiResponse);
          savedCount++;
        }
      } catch (err) {
        console.error('Error saving recurring instance:', err);
      }
    }

    if (savedCount > 0) {
      Notifications.onReservationCreated({
        ...savedInstances[0],
        _batchCount: savedCount,
      });
      Store.persist();
    }

    return savedCount;
  };

  /* ════════════════════════════════════════
     CANCEL SERIES
     ════════════════════════════════════════ */
  const cancelSeries = (recurringGroupId) => {
    const series = Store.getState().reservations.filter(r =>
      r.recurringGroupId === recurringGroupId && r.status === 'active'
    );
    const cancelledAt = new Date().toISOString();
    series.forEach(r => {
      Store.updateReservation(r.id, { status: 'cancelled', cancelledAt });
    });
    Store.persist();
    return series.length;
  };

  const getSeriesInstances = (recurringGroupId) =>
    Store.getState().reservations.filter(r => r.recurringGroupId === recurringGroupId);

  /* ── HELPERS ── */
  const _advance = (date, frequency) => {
    switch (frequency) {
      case 'daily':    date.setDate(date.getDate() + 1);  break;
      case 'weekly':   date.setDate(date.getDate() + 7);  break;
      case 'biweekly': date.setDate(date.getDate() + 14); break;
      case 'monthly':  date.setMonth(date.getMonth() + 1); break;
    }
  };

  const _toDate = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  return { generate, save, cancelSeries, getSeriesInstances };
})();
