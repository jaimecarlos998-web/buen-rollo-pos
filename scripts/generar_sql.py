import openpyxl, collections, sys, json, datetime
wb=openpyxl.load_workbook(sys.argv[1],data_only=True)
def q(v):
    if v is None or (isinstance(v,str) and v.strip()==''): return 'null'
    if isinstance(v,(int,float)): return repr(round(float(v),2))
    if isinstance(v,datetime.datetime): return "'"+v.strftime('%Y-%m-%d %H:%M:%S')+"'"
    return "'"+str(v).strip().replace("'","''")+"'"
def norm_nombre(s): return ' '.join(str(s).split()).upper()
inv=[r for r in wb['Inventario'].iter_rows(min_row=2,values_only=True) if r[0]]
rem=[r for r in wb['Remito'].iter_rows(min_row=2,values_only=True) if r[2]]
ven=[r for r in wb['Ventas'].iter_rows(min_row=2,values_only=True) if r[2]]
prods={}; notas=[]
for r in inv:
    sku=str(r[0]).strip().upper()
    if sku in prods:
        alt='COD-0007' if sku=='COD-0005' and 'COD7' in str(r[1]) else sku+'B'
        notas.append(f'SKU duplicado {sku}: "{norm_nombre(r[1])}" pasa a {alt}'); sku=alt
    prods[sku]=dict(sku=sku,nombre=norm_nombre(r[1]),costo=r[2] if isinstance(r[2],(int,float)) else None,
        precio=r[3] if isinstance(r[3],(int,float)) else 0, stock=r[7] if isinstance(r[7],(int,float)) else 0,
        minimo=r[8] if isinstance(r[8],(int,float)) else 2)
# productos que aparecen en remitos/ventas pero no en Inventario
faltan=collections.OrderedDict()
for r in rem:
    s=str(r[2]).strip().upper()
    if s not in prods:
        f=faltan.setdefault(s,dict(sku=s,nombre=norm_nombre(r[3]),costo=None,precio=0,stock=0,minimo=2))
        f['costo']=r[5]; f['stock']+=r[4] or 0
for r in ven:
    s=str(r[2]).strip().upper()
    if s not in prods:
        f=faltan.setdefault(s,dict(sku=s,nombre=norm_nombre(r[3]),costo=None,precio=0,stock=0,minimo=2))
        f['precio']=r[5]; f['stock']-=r[4] or 0
for s,f in faltan.items():
    notas.append(f'Producto {s} "{f["nombre"]}" no estaba en Inventario: creado desde remitos/ventas (stock {f["stock"]:g})')
    prods[s]=f
out=[]
out.append('insert into public.productos (sku,nombre,costo,precio,stock,stock_minimo) values\n'+',\n'.join(
  f"({q(p['sku'])},{q(p['nombre'])},{q(p['costo'])},{q(p['precio'] or 0)},{q(p['stock'] or 0)},{q(p['minimo'])})" for p in prods.values())+';')
# proveedores
provs=sorted({str(r[7]).strip() for r in rem if r[7]})
out.append('insert into public.proveedores (nombre) values '+','.join(f'({q(p)})' for p in provs)+' on conflict do nothing;')
# compras
grupos=collections.OrderedDict()
for r in rem:
    nro=r[0]; nro=str(int(nro)) if isinstance(nro,float) else (str(nro).strip() if nro else None)
    fecha=r[1].date() if isinstance(r[1],datetime.datetime) else None
    grupos.setdefault((nro,str(r[7]).strip() if r[7] else None,fecha),[]).append(r)
for (nro,prov,fecha),items in grupos.items():
    tot=sum((i[4] or 0)*(i[5] or 0) for i in items)
    vals=',\n'.join(f"({q(str(i[2]).strip().upper())},{q(norm_nombre(i[3]))},{q(i[4])},{q(i[5])})" for i in items)
    out.append(f"""with c as (insert into public.compras (nro_comprobante,fecha,proveedor_id,total,origen,notas)
 values ({q(nro)},{q(fecha.isoformat()) if fecha else "'2026-09-16'"},(select id from public.proveedores where nombre={q(prov)}),{q(tot)},'importado','Importado de planilla ({items[0][9] or 'Carga inicial'})') returning id)
insert into public.compra_items (compra_id,producto_id,sku,nombre,cantidad,costo_unit,subtotal)
select c.id,p.id,x.sku,x.nombre,x.cant,x.costo,x.cant*x.costo from c,(values {vals}) x(sku,nombre,cant,costo)
left join public.productos p on p.sku=x.sku;""")
# ventas
PAGO={'transferencia':'Transferencia','transfrencia':'Transferencia','efectivo':'Efectivo','mercadopago':'Mercado Pago',
      'mercado pago':'Mercado Pago','crédito':'Crédito','credito':'Crédito','débito':'Débito','debito':'Débito'}
peds=collections.OrderedDict()
for r in ven: peds.setdefault(r[1],[]).append(r)
vrows=[];irows=[]
for nro,items in peds.items():
    r=items[0]; mp=r[7]; mp=PAGO.get(str(mp).strip().lower(),str(mp).strip()) if mp else 'Sin dato'
    nota=(r[9] or '').strip() or None
    cli=(str(r[8]).strip() if r[8] and str(r[8]).strip() not in ('-','') else None)
    tot=sum(i[6] if isinstance(i[6],(int,float)) else i[4]*i[5] for i in items)
    costo=sum((prods[str(i[2]).strip().upper()]['costo'] or 0)*i[4] for i in items)
    fecha=r[0].strftime('%Y-%m-%d %H:%M:%S')+'-03'
    vrows.append(f"({q(nro)},'{fecha}',{q(cli)},{q(mp)},{q(tot)},{q(costo)},{q(nota)},'importado')")
    for i in items:
        s=str(i[2]).strip().upper()
        irows.append(f"({q(nro)},{q(s)},{q(norm_nombre(i[3]))},{q(i[4])},{q(i[5])},{q(prods[s]['costo'])})")
out.append('insert into public.ventas (nro,fecha,cliente,metodo_pago,total,costo_total,notas,origen) values\n'+',\n'.join(vrows)+';')
out.append("""insert into public.venta_items (venta_id,producto_id,sku,nombre,cantidad,precio_unit,costo_unit,subtotal)
select v.id,p.id,x.sku,x.nombre,x.cant,x.precio,x.costo,x.cant*x.precio from (values\n"""+',\n'.join(irows)+""") x(nro,sku,nombre,cant,precio,costo)
join public.ventas v on v.nro=x.nro left join public.productos p on p.sku=x.sku;""")
open('import.sql','w').write('\n\n'.join(out))
print('\n'.join(notas)); print(len(prods),'productos',len(provs),'proveedores',len(grupos),'compras',len(peds),'pedidos',len(irows),'items')
print(collections.Counter(v.split(',')[3] for v in vrows))
