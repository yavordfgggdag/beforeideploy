-- Generated V12 catalog migration. Preserves existing Paddle IDs and unrelated settings.
-- Existing subscribers retain their provider prices. Reconcile sandbox IDs in Admin before enabling sales.
do $$
declare old_catalog jsonb; next_catalog jsonb := '{"version":"v12.2","currency":"EUR","taxInclusive":true,"mode":"sandbox","trial":{"days":7,"plan":"high","tokens":50000,"activeSites":1},"plans":{"flash":{"price":9.99,"paddlePriceId":null,"yearly":{"price":99.9,"paddlePriceId":null},"credits":100000,"activeSites":1,"activeSitesMax":1,"validityMonths":1,"window5h":20000,"weekly":40000,"extras":{"domain":false,"netlifyCredits":false,"boost":false}},"high":{"price":29.99,"paddlePriceId":null,"yearly":{"price":299.9,"paddlePriceId":null},"credits":300000,"activeSites":3,"activeSitesMax":3,"validityMonths":3,"window5h":60000,"weekly":120000,"extras":{"domain":false,"netlifyCredits":false,"boost":false}},"knight":{"price":99.99,"paddlePriceId":null,"yearly":{"price":999.9,"paddlePriceId":null},"credits":1000000,"activeSites":10,"activeSitesMax":25,"validityMonths":10,"window5h":200000,"weekly":400000,"extras":{"domain":true,"netlifyCredits":false,"boost":true}}},"packs":[{"id":"pack-100k","tokens":100000,"price":4.99,"validityMonths":12,"paddlePriceId":null},{"id":"pack-500k","tokens":500000,"price":19.99,"validityMonths":12,"paddlePriceId":null},{"id":"pack-1m","tokens":1000000,"price":39.99,"validityMonths":12,"paddlePriceId":null}]}'::jsonb; old_plans jsonb; tier text; pack jsonb; old_pack jsonb; packs jsonb := '[]'::jsonb;
begin
  select value into old_catalog from public.settings where key = 'billing.catalog';
  if old_catalog->>'version' = next_catalog->>'version' then return; end if;
  foreach tier in array array['flash','high','knight'] loop
    next_catalog := jsonb_set(next_catalog, array['plans',tier,'paddlePriceId'], coalesce(old_catalog #> array['plans',tier,'paddlePriceId'], 'null'::jsonb));
    next_catalog := jsonb_set(next_catalog, array['plans',tier,'yearly','paddlePriceId'], coalesce(old_catalog #> array['plans',tier,'yearly','paddlePriceId'], 'null'::jsonb));
    next_catalog := jsonb_set(next_catalog, array['plans',tier,'needsReconciliation'], to_jsonb(coalesce(old_catalog #>> array['plans',tier,'price'],'') <> next_catalog #>> array['plans',tier,'price']));
    next_catalog := jsonb_set(next_catalog, array['plans',tier,'yearly','needsReconciliation'], to_jsonb(coalesce(old_catalog #>> array['plans',tier,'yearly','price'],'') <> next_catalog #>> array['plans',tier,'yearly','price']));
  end loop;
  for pack in select * from jsonb_array_elements(next_catalog->'packs') loop
    select value into old_pack from jsonb_array_elements(coalesce(old_catalog->'packs','[]'::jsonb)) where value->>'id' = pack->>'id' limit 1;
    packs := packs || jsonb_build_array(pack || jsonb_build_object('paddlePriceId',coalesce(old_pack->'paddlePriceId','null'::jsonb),'needsReconciliation',coalesce(old_pack->>'price','') <> pack->>'price'));
  end loop;
  next_catalog := jsonb_set(next_catalog, '{packs}', packs);
  insert into public.settings(key,value) values ('billing.catalog',coalesce(old_catalog,'{}'::jsonb) || next_catalog) on conflict(key) do update set value=excluded.value;
  select value into old_plans from public.settings where key='plans';
  insert into public.settings(key,value) values ('plans',coalesce(old_plans,'{}'::jsonb) || '{"flash":{"tokens":100000,"max_active_sites":1,"fair_use_sites":1,"validity_months":1},"high":{"tokens":300000,"max_active_sites":3,"fair_use_sites":3,"validity_months":3},"knight":{"tokens":1000000,"max_active_sites":10,"fair_use_sites":25,"validity_months":10}}'::jsonb) on conflict(key) do update set value=excluded.value;
end $$;
