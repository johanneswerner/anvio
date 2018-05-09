var stage;
var histogram_data;

$(document).ready(function() {
    stage = new NGL.Stage("viewport");
    stage.setParameters({
        backgroundColor:"white"
    });

    window.addEventListener( "resize", function( event ){
        stage.handleResize();
    }, false );

    $('#gene_callers_id_list').on('change', function(ev) {
        load_protein($('#gene_callers_id_list').val());
    });

    $.ajax({
        type: 'GET',
        cache: false,
        url: '/data/get_initial_data?timestamp=' + new Date().getTime(),
        success: function(data) {
            let available_gene_callers_ids = data['available_gene_callers_ids'];
            let available_engines = data['available_engines']; 

            available_gene_callers_ids.forEach(function(gene_callers_id) {
                $('#gene_callers_id_list').append(`<option id=${gene_callers_id}>${gene_callers_id}</option>`);
            });

            $('#gene_callers_id_list').trigger('change');

            let default_engine = available_engines[0];
            available_engines.forEach(function(engine) {
                $('#engine_list').append(`<input type="radio" name="engine" onclick="create_ui();" value="${engine}" id="engine_${engine}" ${engine == default_engine ? 'checked="checked"' : ''}><label for="engine_${engine}">${engine}</label>`);
            });

            //create_ui();
        }
    });
});


function defaultStructureRepresentation( component ){
    // bail out if the component does not contain a structure
    if( component.type !== "structure" ) return;

    component.addRepresentation( "cartoon", {
        aspectRatio: 3.0,
        scale: 1.5
    } );

    // add annotation to a protein chain
    var chainText = {
    "A": "how do i put gene_caller_id here?",
    }
    var ap = component.structure.getAtomProxy()
    component.structure.eachChain(function (cp) {
        // annotation is anchored to the residue index equal to half the total number of residues
        ap.index = cp.atomOffset + Math.floor(cp.atomCount / 2)
        component.addAnnotation(ap.positionToVector3(), chainText[ cp.chainname ])
    }, new NGL.Selection("polymer"));

    var pa = component.structure.getPrincipalAxes();
    stage.animationControls.rotate(pa.getRotationQuaternion(), 1000);
    stage.autoView();        
}


function load_protein(gene_callers_id) {
    $.ajax({
        type: 'GET',
        cache: false,
        url: '/data/get_structure/' + gene_callers_id,
        success: function(data) {
            histogram_data = data['histograms'];

            // create tooltip element and add to document body
            var tooltip = document.createElement("div");
            Object.assign(tooltip.style, {
                display: "none",
                position: "fixed",
                zIndex: 10,
                pointerEvents: "none",
                backgroundColor: "rgba( 0, 0, 0, 0.6 )",
                color: "lightgrey",
                padding: "8px",
                fontFamily: "sans-serif"
            })
            document.body.appendChild(tooltip)

            stage.removeAllComponents();

            var stringBlob = new Blob( [ data['pdb_content'] ], { type: 'text/plain'} );
            stage.loadFile(stringBlob, { ext: "pdb", name: gene_callers_id }).then(defaultStructureRepresentation).then();
            // remove default hoverPick mouse action
            stage.mouseControls.remove("hoverPick")
            // listen to `hovered` signal to move tooltip around and change its text
            stage.signals.hovered.add(function (pickingProxy) {
                if (pickingProxy && (pickingProxy.atom || pickingProxy.bond)) {
                    var atom = pickingProxy.atom || pickingProxy.closestBondAtom
                    var mp = pickingProxy.mouse.position
                    tooltip.innerText = "SAAV: \n" + atom.qualifiedName() + "\nAla:\t19" + "\nIle:\t5"
                    tooltip.style.bottom = window.innerHeight - mp.y + 3 + "px"
                    tooltip.style.left = mp.x + 3 + "px"
                    tooltip.style.display = "block"
                } else {
                tooltip.style.display = "none"
              }
            });
        }
    });
}

function draw_variability() {
    let gene_callers_id = $('#gene_callers_id_list').val();
    let engine = $('[name=engine]:checked').val();

    // serialize options programatically
    let options = {
        'gene_callers_id': gene_callers_id,
        'engine': engine,
    };

    $('#controls .widget').each((index, widget) => {
        let column = $(widget).attr('data-column');
        let controller = $(widget).attr('data-controller');

        if (controller == 'slider') {
            options[column] = $(widget).find('input').val();
        }
        else if (controller == 'checkbox') {
            options[column] = $(widget).find('input:checkbox:checked').toArray().map((checkbox) => { return $(checkbox).val(); });
        }
    });

    $.ajax({
        type: 'POST',
        cache: false,
        data: {'options': JSON.stringify(options)},
        url: '/data/get_variability',
        success: function(response) {
            let data = JSON.parse(response['data']);
            let total_entries = response['total_entries'];
            let entries_after_filtering = response['entries_after_filtering'];

            let component = stage.compList[0];
            let variant_residues = [];

            for (let index in data) {
                variant_residues.push(data[index]['codon_order_in_gene']);
            }

            component.reprList.forEach((rep) => {
                if (rep.name == 'spacefill') {
                    rep.dispose();
                }
            });

            component.addRepresentation("spacefill", {
                sele: "(" + variant_residues.join(', ') + ") and .CA",
                scale: 1
            });

        },
        error: function(request, status, error) {
            console.log(request, status, error);
        }
    });
};


function draw_histogram() {
    let engine = $('[name=engine]:checked').val();

    for (let column in histogram_data[engine]) {
        let svg = d3.select('#histogram_' + column);

        if (svg.empty()) {
            continue;
        }

        let width = svg.attr('width');
        let height = svg.attr('height');

        // clear existing drawing
        svg.selectAll('*').remove();

        let bins = histogram_data[engine][column]['bins'];
        let counts = histogram_data[engine][column]['counts'];

        var min_count = Math.min(...counts);
        var max_count = Math.max(...counts);
        var max_slider = parseFloat(document.getElementById(column).dataset.sliderMax);
        var min_slider = parseFloat(document.getElementById(column).dataset.sliderMin);

        let normalized_counts = counts.map(v => (v / max_count) * height);
        let normalized_bins = bins.map(v => ((v - min_slider) / (max_slider - min_slider)) * width);

        let data_points = [];

        for (let i=0; i < normalized_bins.length - 1; i++) {
            data_points.push({'x': normalized_bins[i], 'y': height - normalized_counts[i]});
        }

        var interpolate = d3.line()
                            .x(function(d) { return d.x; })
                            .y(function(d) { return d.y; })
                            .curve(d3.curveCardinal);

        var interpolated_line = interpolate(data_points);
        interpolated_line += `L ${data_points[normalized_bins.length - 2]['x']} ${height} L ${data_points[0]['x']} ${height}`;

        svg.append("path")
            .style("fill","#337ab7")
            .attr("d",function(d,i){ return interpolated_line; });
    }
};

function create_ui() {
    let gene_callers_id = $('#gene_callers_id_list').val();
    let engine = $('[name=engine]:checked').val();

   $.ajax({
        type: 'POST',
        cache: false,
        url: '/data/get_column_info',
        data: {
            'gene_callers_id': gene_callers_id,
            'engine': engine
        },
        success: function(data) {
            let container = $('#controls');

            container.empty();

            data.forEach((item) => {
                if (item['controller'] == 'slider') {
                    $(container).append(`
                        <div class="widget" data-column="${item['name']}" data-controller="${item['controller']}">
                            <br />${item['title']}
                            <br />
                            <svg id="histogram_${item['name']}" width="210" height="30" style="position: relative; top: 6;"></svg>   
                            <input id="${item['name']}" 
                                    type="${item['data_type']}" 
                                    data-provide="slider"
                                    data-slider-min="${item['min']}" 
                                    data-slider-max="${item['max']}" 
                                    data-slider-step="${item['step']}" 
                                    data-slider-value="[${item['min']},${item['max']}]">
                        </div>
                    `);
                    $(`#${item['name']}`).slider({}).on('slideStop', () => { draw_variability(); });
                }
                if (item['controller'] == 'checkbox') {
                    $(container).append(`
                        <div class="widget" data-column="${item['name']}" data-controller="${item['controller']}">
                            <br />${item['title']}
                            <br />
                            ${item['choices'].map((choice) => { return `
                                <input class="form-check-input" type="checkbox" id="${item['name']}_${choice}" value="${choice}" onclick="draw_variability();" checked="checked">
                                <label class="form-check-label" for="${item['name']}_${choice}">${choice}</label>`; }).join('')}
                        </div>
                    `);
                }
            });

            draw_histogram();
        }
    });   
}