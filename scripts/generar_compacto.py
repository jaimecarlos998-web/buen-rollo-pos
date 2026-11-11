import openpyxl, collections, sys, datetime
exec(open('generar_sql.py').read().split("out=[]")[0])  # reutiliza la carga/limpieza (prods, rem, ven, notas)
def f(v):
    if v is None or v=='': return ''
    if isinstance(v,float): return ('%.3f'%v).rstrip('0').rstrip('.')
    return str(v).strip().replace('|','/').replace('\n',' ')
P='\n'.join('|'.join(f(x) for x in (p['sku'],p['nombre'],p['costo'],p['precio'] or 0,p['stock'] or 0,p['minimo'])) for p in prods.values())
sql1=f"""insert into public.productos (sku,nombre,costo,precio,stock,stock_minimo)
select split_part(l,'|',1), split_part(l,'|',2), nullif(split_part(l,'|',3),'')::numeric,
 split_part(l,'|',4)::numeric, split_part(l,'|',5)::numeric, split_part(l,'|',6)::numeric
from regexp_split_to_table($d${P}$d$, E'\\n') l;
insert into public.proveedores (nombre) values {','.join("('"+p+"')" for p in sorted({str(r[7]).strip() for r in rem if r[7]}))};"""
# compras
grupos=collections.OrderedDict()
for r in rem:
    nro=r[0]; nro=str(int(nro)) if isinstance(nro,float) else (str(nro).strip() if nro else '')
    fecha=r[1].date().isoformat() if isinstance(r[1],datetime.datetime) else '2026-09-16'
    grupos.setdefault((nro,str(r[7]).strip() if r[7] else '',fecha,r[9] or 'Carga inicial'),[]).append(r)
H=[];I=[]
for k,((nro,prov,fecha,tipo),items) in enumerate(grupos.items()):
    H.append(f'{k}|{nro}|{prov}|{fecha}|{tipo}')
    I+= [f'{k}|{str(i[2]).strip().upper()}|{f(i[4])}|{f(i[5])}' for i in items]
sql2=f"""create temp table _ch as select split_part(l,'|',1)::int k, nullif(split_part(l,'|',2),'') nro, nullif(split_part(l,'|',3),'') prov,
 split_part(l,'|',4)::date fecha, split_part(l,'|',5) tipo from regexp_split_to_table($d${chr(10).join(H)}$d$, E'\\n') l;
create temp table _ci as select split_part(l,'|',1)::int k, split_part(l,'|',2) sku, split_part(l,'|',3)::numeric cant, split_part(l,'|',4)::numeric costo
 from regexp_split_to_table($d${chr(10).join(I)}$d$, E'\\n') l;
alter table public.compras add column _k int;
insert into public.compras (nro_comprobante,fecha,proveedor_id,total,origen,notas,_k)
select h.nro,h.fecha,(select id from public.proveedores where nombre=h.prov),
 (select sum(cant*costo) from _ci where _ci.k=h.k),'importado','Importado de planilla ('||h.tipo||')',h.k from _ch h order by h.fecha, h.k;
insert into public.compra_items (compra_id,producto_id,sku,nombre,cantidad,costo_unit,subtotal)
select c.id,p.id,i.sku,p.nombre,i.cant,i.costo,i.cant*i.costo from _ci i join public.compras c on c._k=i.k join public.productos p on p.sku=i.sku;
alter table public.compras drop column _k;"""
PAGO={'transferencia':'Transferencia','transfrencia':'Transferencia','efectivo':'Efectivo','mercadopago':'Mercado Pago',
      'mercado pago':'Mercado Pago','crédito':'Crédito','credito':'Crédito','débito':'Débito','debito':'Débito'}
peds=collections.OrderedDict()
for r in ven: peds.setdefault(r[1],[]).append(r)
VH=[];VI=[]
for k,(nro,items) in enumerate(peds.items()):
    r=items[0]; mp=r[7]; mp=PAGO.get(str(mp).strip().lower(),str(mp).strip()) if mp else 'Sin dato'
    cli=f(r[8]) if r[8] and str(r[8]).strip() not in ('-','') else ''
    VH.append(f"{k}|{nro}|{r[0].strftime('%Y-%m-%d %H:%M:%S')}|{cli}|{mp}|{f(r[9])}")
    VI+=[f'{k}|{str(i[2]).strip().upper()}|{f(i[4])}|{f(i[5])}' for i in items]
def ventas_sql(hs,its):
    return f"""create temp table if not exists _vh (k int, nro text, fecha timestamptz, cli text, mp text, nota text);
create temp table if not exists _vi (k int, sku text, cant numeric, precio numeric);
insert into _vh select split_part(l,'|',1)::int, split_part(l,'|',2), (split_part(l,'|',3)||'-03')::timestamptz,
 nullif(split_part(l,'|',4),''), split_part(l,'|',5), nullif(split_part(l,'|',6),'') from regexp_split_to_table($d${chr(10).join(hs)}$d$, E'\\n') l;
insert into _vi select split_part(l,'|',1)::int, split_part(l,'|',2), split_part(l,'|',3)::numeric, split_part(l,'|',4)::numeric
 from regexp_split_to_table($d${chr(10).join(its)}$d$, E'\\n') l;"""
mid=len(VH)//2
VI1=[x for x in VI if int(x.split('|')[0])<mid]; VI2=[x for x in VI if int(x.split('|')[0])>=mid]
fin="""insert into public.ventas (nro,fecha,cliente,metodo_pago,total,costo_total,notas,origen)
select h.nro,h.fecha,h.cli,h.mp,(select sum(cant*precio) from _vi where _vi.k=h.k),
 (select sum(i.cant*coalesce(p.costo,0)) from _vi i join public.productos p on p.sku=i.sku where i.k=h.k),h.nota,'importado' from _vh h order by h.fecha;
insert into public.venta_items (venta_id,producto_id,sku,nombre,cantidad,precio_unit,costo_unit,subtotal)
select v.id,p.id,i.sku,p.nombre,i.cant,i.precio,p.costo,i.cant*i.precio from _vi i join _vh h on h.k=i.k
 join public.ventas v on v.nro=h.nro join public.productos p on p.sku=i.sku;
drop table _vh; drop table _vi;"""
open('p1.sql','w').write(sql1); open('p2.sql','w').write(sql2)
open('p3.sql','w').write(ventas_sql(VH[:mid],VI1)+'\n'+ventas_sql(VH[mid:],VI2)+'\n'+fin)
